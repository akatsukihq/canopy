import { beforeEach, afterAll, expect, test, vi } from "vitest";
import { v2 as cloudinary } from "cloudinary";
import { AuthorizationError } from "../lib/admin/index.ts";
import { createBlogDocument, renderBlogDocument } from "../lib/blog/document.ts";

const fixture = vi.hoisted(() => ({
  events: [],
  lookups: [],
  transactions: 0,
  permissions: 0,
  denyAt: 0,
  failTransactionAt: 0,
  failAudit: false,
}));
globalThis.__blogImageTest = fixture;
fixture.AuthorizationError = AuthorizationError;

vi.mock("@/db/index.ts", () => ({
  db: {
    async transaction(callback) {
      fixture.events.push("transaction");
      if (++fixture.transactions === fixture.failTransactionAt) throw new Error("postgres://secret password=private");
      const result = await callback({});
      fixture.events.push("commit");
      return result;
    },
  },
}));
vi.mock("@/lib/admin/adminMutations.ts", () => ({
  async requireTransactionPermission(_transaction, actor, resource, action) {
    fixture.events.push(["permission", actor, resource, action]);
    if (++fixture.permissions === fixture.denyAt) throw new fixture.AuthorizationError("Missing permission: blog.edit");
  },
  async writeAudit(...args) {
    if (fixture.failAudit) throw new Error("private audit failure");
    fixture.events.push(["audit", ...args.slice(1)]);
  },
}));
vi.mock("@/lib/config/integrations.ts", () => ({
  async cloudinaryCredentials() {
    const {
      CLOUDINARY_CLOUD_NAME: cloudName,
      CLOUDINARY_API_KEY: apiKey,
      CLOUDINARY_API_SECRET: apiSecret,
    } = process.env;
    return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
  },
}));
vi.mock("cloudinary", async () => {
  const actual = await vi.importActual("cloudinary");
  return {
    v2: {
      utils: actual.v2.utils,
      api: {
        async resource(publicId, options) {
          fixture.events.push("resource");
          fixture.lookups.push({ publicId, options });
          throw new Error("Completion must not call the Cloudinary Admin API");
        },
      },
    },
  };
});

const { prepareBlogImageUpload, completeBlogImageUpload, BlogImageUploadError } = await import("@/lib/blog/images.ts");

async function rejectsWith(input, matcher) {
  const p = typeof input === "function" ? input() : input;
  let err;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, "expected rejection").toBeInstanceOf(Error);
  if (!matcher) return;
  if (typeof matcher === "function" && (matcher.prototype instanceof Error || matcher === Error))
    expect(err).toBeInstanceOf(matcher);
  else if (matcher instanceof RegExp) expect(err.message).toMatch(matcher);
  else expect(matcher(err)).toBeTruthy();
}

const metadata = (name = "original.png") => ({ name, size: 128, type: "image/png" });
const uploadResponse = (completion, overrides = {}) => ({
  public_id: completion.publicId,
  version: 1234,
  format: "png",
  width: 1,
  height: 1,
  bytes: 128,
  resource_type: "image",
  type: "upload",
  secure_url: `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/v1234/${completion.publicId}.png`,
  ...overrides,
});
const uploadPayload = (completion, overrides = {}) => ({
  ...completion,
  uploaded: uploadResponse(completion, overrides),
});
const savedEnv = Object.fromEntries(
  ["NODE_ENV", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"].map((key) => [
    key,
    process.env[key],
  ]),
);
beforeEach(() => {
  Object.assign(fixture, {
    events: [],
    lookups: [],
    transactions: 0,
    permissions: 0,
    denyAt: 0,
    failTransactionAt: 0,
    failAudit: false,
  });
  process.env.NODE_ENV = "development";
  process.env.CLOUDINARY_CLOUD_NAME = "blog-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
});
afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete globalThis.__blogImageTest;
});

test("preparation signs immutable environment-scoped upload fields without transferring bytes", async () => {
  for (const environment of ["production", "development", "test"]) {
    process.env.NODE_ENV = environment;
    const result = await prepareBlogImageUpload("admin", metadata());
    const { api_key, signature, ...signed } = result.fields;
    expect(result.uploadUrl).toBe("https://api.cloudinary.com/v1_1/blog-cloud/image/upload");
    expect(api_key).toBe("test-key");
    expect(signature).toBe(cloudinary.utils.api_sign_request(signed, "test-secret"));
    expect(signed.asset_folder).toBe(`Canopy/${environment}/blog`);
    expect(signed.public_id).toMatch(new RegExp(`^Canopy/${environment}/blog/[0-9a-f-]{36}$`));
    expect(signed.overwrite).toBe("false");
    expect(signed.type).toBe("upload");
    expect(signed.allowed_formats).toBe("jpg,jpeg,png,webp");
    expect(result.completion.publicId).toBe(signed.public_id);
    expect(String(result.completion.timestamp)).toBe(signed.timestamp);
    expect({ ...result.completion, publicId: undefined, timestamp: undefined, token: undefined }).toEqual({
      ...metadata(),
      cloudName: "blog-cloud",
      publicId: undefined,
      timestamp: undefined,
      token: undefined,
    });
    expect(JSON.stringify(result)).not.toMatch(/test-secret|api_secret/);
  }
  const first = await prepareBlogImageUpload("admin", metadata());
  const second = await prepareBlogImageUpload("admin", metadata());
  expect(first.completion.publicId).not.toBe(second.completion.publicId);
  expect(fixture.lookups.length).toBe(0);
});

test("preparation rejects invalid metadata before signing and requires edit permission", async () => {
  for (const input of [
    null,
    [],
    {},
    { ...metadata(), extra: true },
    { ...metadata(), size: 0 },
    { ...metadata(), size: 5 * 1024 * 1024 + 1 },
    { ...metadata(), size: 1.5 },
    { ...metadata(), type: "image/svg+xml" },
    { ...metadata(), name: "" },
    { ...metadata(), name: "a".repeat(4097) },
    { ...metadata(), name: "\ud800" },
  ]) {
    await rejectsWith(() => prepareBlogImageUpload("admin", input));
  }
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    await prepareBlogImageUpload("admin", { ...metadata(), type, size: 5 * 1024 * 1024 });
  }
  fixture.denyAt = fixture.permissions + 1;
  await rejectsWith(() => prepareBlogImageUpload("reader", metadata()), AuthorizationError);
  expect(fixture.lookups.length).toBe(0);
});

test("completion accepts supplied upload metadata without a resource lookup and authorizes and audits once", async () => {
  const { completion } = await prepareBlogImageUpload("admin", metadata());
  fixture.events = [];
  const transactionsBefore = fixture.transactions;
  const image = await completeBlogImageUpload("admin", uploadPayload(completion, { width: 640, height: 480 }));
  expect(image).toEqual({
    media: {
      v: 1,
      provider: "cloudinary",
      format: "png",
      width: 640,
      height: 480,
      bytes: 128,
      uploadedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      entry: { cloudName: "blog-cloud", publicId: completion.publicId, version: 1234 },
    },
    alt: "original",
    caption: "",
  });
  expect(fixture.lookups.length).toBe(0);
  expect(fixture.transactions - transactionsBefore).toBe(1);
  expect(fixture.events).toEqual([
    "transaction",
    ["permission", "admin", "blog", "edit"],
    [
      "audit",
      "admin",
      "blog.image.upload",
      "blog-image",
      completion.publicId,
      {
        cloudName: "blog-cloud",
        publicId: completion.publicId,
        version: 1234,
        format: "png",
        width: 640,
        height: 480,
      },
    ],
    "commit",
  ]);
  expect(JSON.stringify(fixture.events)).not.toMatch(/test-secret|test-key|original\.png/);
});

test("completion rejects ticket tampering, other users, unknown fields, and invalid tokens before audit", async () => {
  const { completion } = await prepareBlogImageUpload("admin", metadata());
  for (const changed of [
    { publicId: completion.publicId.replace(/.$/, "z") },
    { cloudName: "other-cloud" },
    { timestamp: completion.timestamp - 1 },
    { name: "other.png" },
    { size: 129 },
    { type: "image/jpeg" },
    { token: "0".repeat(64) },
    { token: "short" },
    { width: 1 },
    { secure_url: "https://evil.example/image.png" },
    { secure_url: undefined },
  ]) {
    await rejectsWith(() => completeBlogImageUpload("admin", { ...uploadPayload(completion), ...changed }));
  }
  await rejectsWith(() => completeBlogImageUpload("other-user", uploadPayload(completion)));
  expect(fixture.lookups.length).toBe(0);
});

test("completion rejects expired, future, and other-environment tickets", async () => {
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  const { completion } = await prepareBlogImageUpload("admin", metadata());
  clock.mockImplementation(() => now + 601_000);
  await rejectsWith(() => completeBlogImageUpload("admin", uploadPayload(completion)), /expired|restart|again/i);
  clock.mockImplementation(() => now - 1_000);
  await rejectsWith(() => completeBlogImageUpload("admin", uploadPayload(completion)));
  clock.mockImplementation(() => now);
  process.env.NODE_ENV = "production";
  await rejectsWith(() => completeBlogImageUpload("admin", uploadPayload(completion)));
  expect(fixture.lookups.length).toBe(0);
  clock.mockRestore();
});

test("supplied upload bytes and image metadata are validated before audit", async () => {
  const { completion } = await prepareBlogImageUpload("admin", metadata());
  for (const response of [
    { bytes: 0 },
    { bytes: 5 * 1024 * 1024 + 1 },
    { bytes: 1.5 },
    { bytes: undefined },
    { bytes: "128" },
    { public_id: "different" },
    { format: "svg" },
    { format: undefined },
    { version: 0 },
    { version: 1.5 },
    { version: Number.MAX_SAFE_INTEGER + 1 },
    { width: -1 },
    { width: "1" },
    { height: 30001 },
    { height: undefined },
    { resource_type: "raw" },
    { type: "private" },
    { secure_url: "https://evil.example/image.png" },
    { secure_url: uploadResponse(completion).secure_url.replace("blog-cloud", "other-cloud") },
    { secure_url: uploadResponse(completion).secure_url.replace("/v1234/", "/v9999/") },
    { secure_url: uploadResponse(completion).secure_url + "?download=true" },
    { secure_url: undefined },
  ]) {
    await rejectsWith(
      () => completeBlogImageUpload("admin", uploadPayload(completion, response)),
      BlogImageUploadError,
    );
  }
  for (const uploaded of [
    undefined,
    null,
    [],
    "uploaded",
    1,
    {},
    new Date(),
    { ...uploadResponse(completion), extra: true },
  ]) {
    await rejectsWith(
      () => completeBlogImageUpload("admin", { ...completion, uploaded }),
      (error) => error.code === "UPLOAD_INVALID_RESPONSE",
    );
  }
  expect(fixture.events.some((event) => Array.isArray(event) && event[0] === "audit")).toBe(false);
  expect(fixture.lookups.length).toBe(0);
  expect((await completeBlogImageUpload("admin", uploadPayload(completion, { bytes: 5 * 1024 * 1024 }))).alt).toBe(
    "original",
  );
});

test("default alt text preserves Unicode, length bounds, and HTML escaping", async () => {
  for (const [name, expected] of [
    ["  Local-PDF__guide.PNG", "Local PDF guide"],
    ["Résumé_日本語-📷.webp", "Résumé 日本語 📷"],
    ["report.v2-final.jpeg", "report.v2 final"],
    ["no-extension", "no extension"],
    ["line\nwith\tspaces\u0000and\u007fcontrols.png", "line with spaces and controls"],
    ["a".repeat(499) + "📷.png", "a".repeat(499)],
    ["📷".repeat(251) + ".png", "📷".repeat(250)],
  ]) {
    const { completion } = await prepareBlogImageUpload("admin", metadata(name));
    const image = await completeBlogImageUpload("admin", uploadPayload(completion));
    expect(image.alt).toBe(expected);
    expect(image.alt.length <= 500 && image.alt.isWellFormed()).toBeTruthy();
  }
  const { completion } = await prepareBlogImageUpload("admin", metadata('\"><img src=x onerror=alert(1)>.png'));
  const image = await completeBlogImageUpload("admin", uploadPayload(completion));
  const document = createBlogDocument("Image filename");
  document.body.content = [{ type: "image", attrs: image }];
  const { html } = renderBlogDocument(document);
  expect(html).toMatch(/alt="&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;"/);
  expect((html.match(/<img /g) ?? []).length).toBe(1);
});

test("revoked permissions and audit failures never return successful assets", async () => {
  const { completion } = await prepareBlogImageUpload("admin", metadata());
  fixture.events = [];
  fixture.denyAt = fixture.permissions + 1;
  await rejectsWith(() => completeBlogImageUpload("admin", uploadPayload(completion)), AuthorizationError);
  expect(fixture.events).toEqual(["transaction", ["permission", "admin", "blog", "edit"]]);
  fixture.denyAt = 0;
  fixture.failAudit = true;
  fixture.events = [];
  await rejectsWith(
    () => completeBlogImageUpload("admin", uploadPayload(completion)),
    (error) => error.code === "UPLOAD_FINALIZATION_FAILED" && !/private/.test(error.message),
  );
  expect(fixture.events).toEqual(["transaction", ["permission", "admin", "blog", "edit"]]);
  expect(fixture.lookups.length).toBe(0);
});

test("credentials and database failures remain sanitized and configuration is read at runtime", async () => {
  const { completion: oldCompletion } = await prepareBlogImageUpload("admin", metadata());
  delete process.env.CLOUDINARY_API_SECRET;
  for (const operation of [
    () => prepareBlogImageUpload("admin", metadata()),
    () => completeBlogImageUpload("admin", uploadPayload(oldCompletion)),
  ]) {
    await rejectsWith(operation, (error) => error.code === "UPLOAD_NOT_CONFIGURED");
  }
  process.env.CLOUDINARY_API_SECRET = "changed-secret";
  await rejectsWith(() => completeBlogImageUpload("admin", uploadPayload(oldCompletion)), /authorization is invalid/i);
  const { completion } = await prepareBlogImageUpload("admin", metadata());
  await completeBlogImageUpload("admin", uploadPayload(completion));
  fixture.failTransactionAt = fixture.transactions + 1;
  await rejectsWith(
    () => prepareBlogImageUpload("admin", metadata()),
    (error) => error.code === "UPLOAD_TEMPORARY_FAILURE" && !/private/.test(error.message),
  );
  fixture.failTransactionAt = fixture.transactions + 1;
  await rejectsWith(
    () => completeBlogImageUpload("admin", uploadPayload(completion)),
    (error) => error.code === "UPLOAD_FINALIZATION_FAILED" && !/private/.test(error.message),
  );
  expect(fixture.lookups.length).toBe(0);
});
