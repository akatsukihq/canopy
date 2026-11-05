import { afterAll, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { AuthorizationError } from "../lib/admin/index.ts";
import { createBlogDocument, BlogValidationError } from "../lib/blog/document.ts";
import { BlogError } from "../lib/blog/mutations.ts";
import { BlogImageUploadError } from "../lib/blog/images.ts";

const { state, actionFns, names, reads } = vi.hoisted(() => {
  const state = {
    actor: "session-admin",
    calls: [],
    captured: [],
    error: null,
    data: { id: "post-id" },
    sessionError: null,
  };
  globalThis.__blogActionTest = state;
  const actionFns = (exports) =>
    Object.fromEntries(
      exports.map((name) => [
        name,
        async (...args) => {
          const s = globalThis.__blogActionTest;
          s.calls.push({ name, args });
          if (s.error) throw s.error;
          return s.data;
        },
      ]),
    );
  const names = [
    "createBlogPost",
    "duplicateBlogPost",
    "saveBlogDraft",
    "publishBlogPost",
    "scheduleBlogPost",
    "cancelBlogSchedule",
    "retryBlogSchedule",
    "unpublishBlogPost",
    "trashBlogPost",
    "restoreTrashedBlogPost",
    "restoreBlogRevision",
    "saveBlogTerm",
  ];
  const reads = ["getBlogPost", "getBlogRevision", "listBlogPosts", "listBlogRevisions", "listBlogTaxonomy"];
  return { state, actionFns, names, reads };
});

vi.mock("@sentry/core", async (importOriginal) => ({
  ...(await importOriginal()),
  captureException: (error) => globalThis.__blogActionTest.captured.push(error),
  getActiveSpan: () => undefined,
}));
vi.mock("@/lib/admin/access.ts", () => ({
  getActorUserId: async () => {
    const s = globalThis.__blogActionTest;
    if (s.sessionError) throw s.sessionError;
    return s.actor;
  },
}));
// Spread the (already test-loaded) real modules to keep their error classes, override the data functions with trackers.
vi.mock("@/lib/blog/mutations.ts", async (importOriginal) => ({ ...(await importOriginal()), ...actionFns(names) }));
vi.mock("@/lib/blog/images.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  ...actionFns(["prepareBlogImageUpload", "completeBlogImageUpload"]),
}));
vi.mock("@/lib/blog/queries.ts", () => actionFns(reads));

const actions = await import("@/app/admin/(protected)/blog/actions.ts");

function reset() {
  state.calls = [];
  state.captured = [];
  state.error = null;
  state.sessionError = null;
  state.data = { id: "post-id" };
}
afterAll(() => {
  delete globalThis.__blogActionTest;
});
test("blog action identity always comes from session and unknown operations cannot dispatch", async () => {
  reset();
  expect((await actions.mutateBlogAction("create", { title: "Post" })).ok).toBe(true);
  expect(state.calls).toEqual([{ name: "createBlogPost", args: ["session-admin", { title: "Post" }] }]);
  for (const operation of ["__proto__", "constructor", "toString", "unknown"]) {
    expect((await actions.mutateBlogAction(operation, {})).code).toBe("VALIDATION");
  }
  expect(state.calls.length).toBe(1);
});
test("known failures are actionable while unexpected database/provider details stay private", async () => {
  reset();
  for (const [error, code] of [
    [new BlogError("CONFLICT", "Reload latest version"), "CONFLICT"],
    [new BlogValidationError("Excerpt is required"), "VALIDATION"],
    [new AuthorizationError("Private role data"), "FORBIDDEN"],
    [new Error("postgres://secret@example.invalid password=hidden"), "TEMPORARY_FAILURE"],
  ]) {
    state.error = error;
    state.captured = [];
    const result = await actions.mutateBlogAction("save", {});
    expect(result.code).toBe(code);
    expect(state.captured).toEqual(code === "TEMPORARY_FAILURE" ? [error] : []);
    expect(JSON.stringify(result)).not.toMatch(/secret|password=hidden|Private role data/);
    if (code === "TEMPORARY_FAILURE") expect(result.message).toBe("[hidden] password=[hidden]");
  }
});
test("blog actions return original unexpected messages with their existing fallbacks", async () => {
  reset();
  for (const [invoke, fallback] of [
    [() => actions.mutateBlogAction("save", {}), "The change could not be saved. Try again."],
    [() => actions.readBlogAction({ operation: "post", postId: "post" }), "The change could not be saved. Try again."],
    [
      () => actions.prepareBlogImageUploadAction({ name: "image.png", size: 100, type: "image/png" }),
      "The image upload failed unexpectedly. Try uploading the image again.",
    ],
  ]) {
    state.error = new Error("Connection timed out");
    const result = await invoke();
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Connection timed out");
    expect("stack" in result).toBe(false);
    state.error = new Error("");
    expect((await invoke()).message).toBe(fallback);
  }
});
test("missing session control flow escapes the action error mapping before any operation", async () => {
  reset();
  state.sessionError = new Error("NEXT_REDIRECT");
  await expect(actions.mutateBlogAction("publish", {})).rejects.toThrow(/NEXT_REDIRECT/);
  await expect(actions.readBlogAction({ operation: "post", postId: "post" })).rejects.toThrow(/NEXT_REDIRECT/);
  expect(state.calls.length).toBe(0);
});
test("private preview renders validated content and keeps revision reads bound to post and actor", async () => {
  reset();
  const document = createBlogDocument("Private");
  document.body = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "<script>secret draft</script>" }] }],
  };
  state.data = { document };
  const result = await actions.readBlogAction({
    operation: "preview",
    postId: "post",
    revisionId: "rev",
  });
  expect(result.ok).toBe(true);
  expect(result.data.robots).toBe("noindex, nofollow");
  expect(result.data.html).toMatch(/&lt;script&gt;/);
  expect(state.calls).toEqual([{ name: "getBlogRevision", args: ["session-admin", "post", "rev"] }]);
  state.data = null;
  expect((await actions.readBlogAction({ operation: "preview", postId: "missing" })).code).toBe("NOT_FOUND");
});
test("read rejects forged identity and image actions bind metadata to the session actor", async () => {
  reset();
  expect((await actions.readBlogAction({ operation: "post", postId: "post", actor: "forged" })).code).toBe(
    "VALIDATION",
  );
  expect(state.calls.length).toBe(0);
  const input = { name: "image.png", size: 100, type: "image/png" };
  expect((await actions.prepareBlogImageUploadAction(input)).ok).toBe(true);
  const completion = { publicId: "signed-image", token: "signed-token" };
  expect((await actions.completeBlogImageUploadAction(completion)).ok).toBe(true);
  expect(state.calls).toEqual([
    { name: "prepareBlogImageUpload", args: ["session-admin", input] },
    { name: "completeBlogImageUpload", args: ["session-admin", completion] },
  ]);
  reset();
  state.sessionError = new Error("NEXT_REDIRECT");
  await expect(actions.prepareBlogImageUploadAction(input)).rejects.toThrow(/NEXT_REDIRECT/);
  await expect(actions.completeBlogImageUploadAction(completion)).rejects.toThrow(/NEXT_REDIRECT/);
  expect(state.calls.length).toBe(0);
});

test("image upload actions preserve safe upload diagnostics and do not report draft-save failures", async () => {
  reset();
  for (const [error, code, message] of [
    [
      new BlogImageUploadError("UPLOAD_NOT_CONFIGURED", "Configure Cloudinary for image uploads."),
      "UPLOAD_NOT_CONFIGURED",
      "Configure Cloudinary for image uploads.",
    ],
    [new BlogImageUploadError("UPLOAD_REJECTED", "Choose another image."), "UPLOAD_REJECTED", "Choose another image."],
    [
      new BlogImageUploadError("UPLOAD_FINALIZATION_FAILED", "Image upload could not be recorded. Retry."),
      "UPLOAD_FINALIZATION_FAILED",
      "Image upload could not be recorded. Retry.",
    ],
    [new AuthorizationError("private role data"), "FORBIDDEN"],
    [new BlogValidationError("Use a JPEG, PNG or WebP image."), "VALIDATION", "Use a JPEG, PNG or WebP image."],
    [new Error("cloudinary://key:credential-secret@private"), "UPLOAD_TEMPORARY_FAILURE"],
  ]) {
    state.error = error;
    for (const action of [actions.prepareBlogImageUploadAction, actions.completeBlogImageUploadAction]) {
      const result = await action({});
      expect(result.ok).toBe(false);
      expect(result.code).toBe(code);
      if (message) expect(result.message).toBe(message);
      expect(JSON.stringify(result)).not.toMatch(/credential-secret|private|could not be saved/);
    }
  }
});
