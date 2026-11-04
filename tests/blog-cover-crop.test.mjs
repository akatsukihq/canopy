import { afterAll, afterEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ values: [], index: 0, changes: [], uploads: [], editable: true }));
globalThis.__coverCropTest = state;

vi.mock("react", () => {
  const s = state;
  function useState(initial) {
    const i = s.index++;
    if (!(i in s.values)) s.values[i] = typeof initial === "function" ? initial() : initial;
    return [
      s.values[i],
      (value) => {
        if (s.unmounted) s.updatesAfterUnmount++;
        const next = typeof value === "function" ? value(s.values[i]) : value;
        if (!Object.is(next, s.values[i])) {
          s.values[i] = next;
          s.dirty = true;
        }
      },
    ];
  }
  function useRef(initial) {
    return useState(() => ({ current: initial }))[0];
  }
  function useEffect(callback, deps) {
    if (!s.runEffects) return;
    const i = s.index++,
      previous = s.values[i];
    if (!previous || !deps || deps.some((value, j) => !Object.is(value, previous.deps[j]))) {
      s.values[i] = { deps, cleanup: previous?.cleanup };
      s.effects.push(() => {
        previous?.cleanup?.();
        s.values[i].cleanup = callback();
      });
    }
  }
  function useId() {
    return "test";
  }
  return { useState, useRef, useEffect, useId };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({}) }));
vi.mock("next/link", () => ({ default: function Link() {} }));
vi.mock("@tiptap/react", () => {
  const editor = {
    get isEditable() {
      return state.editable;
    },
    setEditable() {},
  };
  return { useEditor: () => editor, ReactNodeViewRenderer: () => {}, EditorContent: () => {} };
});
vi.mock("@tiptap/starter-kit", () => ({ default: { configure: () => ({}) } }));
vi.mock("@tiptap/extension-table", () => ({ TableKit: { configure: () => ({}) } }));
vi.mock("@/components/ui/index.tsx", () => {
  const toast = Object.assign(() => {}, {
    error(message) {
      state.errors?.push(message);
    },
    success() {},
    dismiss() {},
  });
  const ui = { toast, Popover: { Root() {}, Trigger() {}, Portal() {}, Content() {}, Arrow() {} } };
  for (const name of [
    "BackButton",
    "DropdownMenuItem",
    "AlertBanner",
    "AlertDialog",
    "AlertDialogContent",
    "AlertDialogHeader",
    "AlertDialogTitle",
    "AlertDialogDescription",
    "AlertDialogFooter",
    "AlertDialogCancel",
    "Button",
    "FileUploadZone",
    "Input",
    "Label",
    "Textarea",
    "Toaster",
  ]) {
    ui[name] = { [name]: () => {} }[name];
  }
  return ui;
});
vi.mock("@/components/ui/components/toast", () => ({ createToastManager: () => ({ add() {}, close() {} }) }));
vi.mock("@/app/admin/(protected)/blog/actions", () => ({ mutateBlogAction: async () => {} }));
vi.mock("@/app/admin/(protected)/blog/lib/imageUpload.ts", () => ({
  uploadBlogImageDirect: async (file) => {
    state.uploads.push(file);
    return state.upload();
  },
}));
vi.mock("@/app/admin/(protected)/blog/lib/draftPersistence", () => ({
  createDraftPersistence: () => ({
    start() {},
    stop() {},
    attachStorage() {
      return null;
    },
    change(value) {
      state.changes.push(value);
    },
  }),
}));
vi.mock("@/app/admin/(protected)/blog/lib/useBlogTaxonomyOptions", () => ({
  useBlogTaxonomyOptions: (kind, initial) => initial,
}));
vi.mock("@/app/admin/(protected)/blog/lib/imageNode", () => ({
  BlogImageNode: {
    extend() {
      return {
        configure() {
          return {};
        },
      };
    },
  },
  blogEditorImageSource: (media) => "https://example.test/" + media.entry.publicId,
}));
vi.mock("@/app/admin/(protected)/blog/lib/formattingExtensions", () => ({ blogFormattingExtensions: [] }));
vi.mock("@/lib/markdown/codeHighlight", () => ({ codeLowlight: {} }));
vi.mock("@/lib/blog/math", () => ({ normalizeBlogMath: (node) => node }));
vi.mock("@/app/admin/(protected)/blog/lib/mathExtensions", () => ({ BlogInlineMath: {}, BlogBlockMath: {} }));
vi.mock("@/app/admin/(protected)/blog/lib/imagePaste", () => ({ pasteBlogImages: () => {} }));
vi.mock("@/app/admin/(protected)/blog/lib/tableEditing", () => ({ BlogTableCell: {}, BlogTableHeader: {} }));
vi.mock("katex/dist/katex.min.css", () => ({ default: {} }));
vi.mock("@/app/admin/(protected)/blog/components/BlogEditor.module.css", () => ({ default: {} }));
vi.mock("@/components/content/codeHighlight.module.css", () => ({ default: {} }));
vi.mock("@/components/content/content.module.css", () => ({ default: {} }));
vi.mock("@/app/admin/(protected)/blog/components/BlogEditorShell", () => ({
  BlogEditorShell: function BlogEditorShell() {},
}));
vi.mock("@/app/admin/(protected)/blog/components/BlogAssistantPanel", () => ({
  BlogAssistantPanel: function BlogAssistantPanel() {},
}));
vi.mock("@/app/admin/(protected)/blog/components/BlogArticleOutline", () => ({
  BlogArticleOutline: function BlogArticleOutline() {},
}));
vi.mock("@/app/admin/(protected)/blog/components/BlogSelectionToolbar", () => ({
  BlogSelectionToolbar: function BlogSelectionToolbar() {},
}));
vi.mock("@/app/admin/(protected)/blog/components/BlogHistoryPanel", () => ({
  BlogHistoryPanel: function BlogHistoryPanel() {},
}));
vi.mock("@/app/admin/(protected)/blog/components/BlogTableControls", () => ({
  BlogTableControls: function BlogTableControls() {},
}));
vi.mock("@/app/admin/(protected)/blog/components/BlogBlockControls", () => ({
  BlogBlockControls: function BlogBlockControls() {},
}));
vi.mock("@/app/admin/(protected)/blog/components/BlogImageView", () => ({
  BlogImageView: function BlogImageView() {},
}));
vi.mock("@/app/admin/(protected)/blog/components/BlogTaskItemView", () => ({
  BlogTaskItemView: function BlogTaskItemView() {},
}));
vi.mock("@/app/admin/(protected)/blog/components/BlogCodeBlockView", () => ({
  BlogCodeBlockView: function BlogCodeBlockView() {},
}));
vi.mock("@/app/admin/(protected)/blog/components/BlogImageCropDialog", () => ({
  BlogImageCropDialog: function BlogImageCropDialog() {},
}));
vi.mock("@/app/admin/(protected)/blog/components/BlogPostSettings", () => ({
  BlogPostSettings: function BlogPostSettings() {},
}));
vi.mock("@/app/admin/(protected)/blog/components/BlogPublishPanel", () => ({
  BlogPublishPanel: function BlogPublishPanel() {},
}));
vi.mock("@/app/admin/(protected)/blog/components/BlogFormattingToolbar", () => ({
  BlogFormattingToolbar: function BlogFormattingToolbar() {},
  BlogBlockMenu: function BlogBlockMenu() {},
}));

const { BlogEditor } = await import("@/app/admin/(protected)/blog/components/BlogEditor.tsx");

const cleanups = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()();
});
afterAll(() => {
  delete globalThis.__coverCropTest;
});

function coverMedia(publicId, version, width, height) {
  return {
    v: 1,
    provider: "cloudinary",
    format: "png",
    width,
    height,
    uploadedAt: "2026-01-01T00:00:00.000Z",
    entry: { cloudName: "demo", publicId, version },
  };
}

test("cover crop preserves metadata and current draft, rejects failures and stale images, and cancels without mutation", async () => {
  const original = {
    media: coverMedia("original", 1, 800, 600),
    alt: "Cover description",
    caption: "Credit",
  };
  const cropped = {
    media: coverMedia("cropped", 1, 400, 300),
    alt: "",
    caption: "",
  };
  const props = {
    actorId: "admin",
    canEdit: true,
    categories: { items: [] },
    tags: { items: [] },
    tools: [],
    post: {
      id: "post",
      slug: "story",
      version: 1,
      draftDocument: {
        title: "Story",
        excerpt: "",
        authorName: "Team",
        category: null,
        tags: [],
        relatedToolIds: [],
        body: { type: "doc" },
        coverImage: original,
      },
    },
  };
  const file = new File(["crop"], "crop.png", { type: "image/png" });
  const walk = (node) =>
    Array.isArray(node) ? node.flatMap(walk) : node?.props ? [node, ...walk(node.props.children)] : [];
  function render() {
    state.index = 0;
    return walk(BlogEditor(props));
  }
  const button = (nodes, label) =>
    nodes.find((node) => node.type.name === "Button" && [node.props.children].flat().includes(label));
  const dialog = () => render().find((node) => node.type.name === "BlogImageCropDialog");
  function reset() {
    state.values = [];
    state.changes = [];
    state.uploads = [];
    state.editable = true;
    state.upload = async () => ({ ok: true, data: cropped });
  }

  reset();
  button(render(), "Crop cover").props.onClick();
  expect(dialog()).toBeTruthy();
  dialog().props.onClose();
  expect(dialog()).toBe(undefined);
  expect(state.changes.length).toBe(0);
  expect(state.uploads.length).toBe(0);

  button(render(), "Crop cover").props.onClick();
  state.upload = async () => ({ ok: false, message: "Upload failed" });
  await expect(dialog().props.onApply(file)).rejects.toThrow();
  expect(state.changes.length).toBe(0);
  state.upload = async () => ({ ok: true, data: cropped });
  const title = render().find((node) => node.props.id === "blog-title");
  title.props.onChange({ target: { value: "Updated title" } });
  await dialog().props.onApply(file);
  expect(state.changes.at(-1).title).toBe("Updated title");
  expect(state.changes.at(-1).coverImage).toEqual({
    ...cropped,
    alt: original.alt,
    caption: original.caption,
  });

  reset();
  button(render(), "Crop cover").props.onClick();
  const apply = dialog().props.onApply;
  button(render(), "Remove cover").props.onClick();
  await expect(apply(file)).rejects.toThrow();
  expect(state.uploads.length).toBe(0);
  expect(state.changes.at(-1).coverImage).toBe(null);

  reset();
  button(render(), "Crop cover").props.onClick();
  state.upload = async () => {
    state.editable = false;
    return { ok: true, data: cropped };
  };
  await expect(dialog().props.onApply(file)).rejects.toThrow();
  expect(state.changes.length).toBe(0);
});

test("cover settings open only on activation and remain open until dismissed", () => {
  state.values = [];
  state.changes = [];
  state.editable = true;
  const props = {
    actorId: "admin",
    canEdit: true,
    categories: { items: [] },
    tags: { items: [] },
    tools: [],
    post: {
      id: "post",
      slug: "story",
      version: 1,
      draftDocument: {
        title: "Story",
        excerpt: "",
        authorName: "Team",
        category: null,
        tags: [],
        relatedToolIds: [],
        body: { type: "doc" },
        coverImage: {
          media: coverMedia("cover", 1, 800, 600),
          alt: "Cover",
          caption: "",
        },
      },
    },
  };
  const walk = (node) =>
    Array.isArray(node) ? node.flatMap(walk) : node?.props ? [node, ...walk(node.props.children)] : [];
  function render() {
    state.index = 0;
    const nodes = walk(BlogEditor(props));
    return {
      trigger: nodes.find((node) => node.props.id === "blog-edit-cover").props,
      panel: nodes.find((node) => node.props["aria-label"] === "Cover image settings").props,
      root: nodes.find((node) => node.type.name === "Root").props,
    };
  }
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { getElementById: () => ({ focus() {} }) },
  });
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  try {
    expect(render().root.open).toBe(false);
    for (const pointerType of ["mouse", "pen", "touch"]) {
      render().trigger.onPointerEnter?.({ pointerType });
      render().trigger.onFocus?.({});
      vi.advanceTimersByTime(1000);
      expect(render().root.open).toBe(false);
    }
    render().trigger.onClick({ preventDefault() {} });
    expect(render().root.open).toBe(true);
    render().trigger.onPointerLeave?.();
    render().panel.onPointerLeave?.();
    render().panel.onBlurCapture?.();
    vi.advanceTimersByTime(1000);
    expect(render().root.open).toBe(true);
    render().root.onOpenChange(false);
    expect(render().root.open).toBe(false);
    render().trigger.onPointerEnter?.({ pointerType: "mouse" });
    vi.advanceTimersByTime(1000);
    expect(render().root.open).toBe(false);
    expect(state.changes.length).toBe(0);
  } finally {
    vi.useRealTimers();
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
  }
});

const savedCover = {
  media: coverMedia("saved-cover", 1, 800, 600),
  alt: "Saved description",
  caption: "Credit",
};
const uploadedCover = {
  media: coverMedia("uploaded-cover", 2, 800, 600),
  alt: "Uploaded description",
  caption: "",
};

function coverUploadHarness(coverImage = null) {
  Object.assign(state, {
    values: [],
    index: 0,
    changes: [],
    uploads: [],
    errors: [],
    effects: [],
    editable: true,
    runEffects: true,
    unmounted: false,
    updatesAfterUnmount: 0,
  });
  let finish;
  state.upload = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const originalGlobals = ["window", "document"].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage: {}, addEventListener() {}, removeEventListener() {} },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { addEventListener() {}, removeEventListener() {}, getElementById: () => ({ focus() {} }) },
  });
  const created = [];
  const revoked = [];
  const createSpy = vi.spyOn(URL, "createObjectURL").mockImplementation((file) => {
    created.push(file);
    return `blob:cover-preview-${created.length}`;
  });
  const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => revoked.push(url));
  const props = {
    actorId: "admin",
    canEdit: true,
    categories: { items: [] },
    tags: { items: [] },
    tools: [],
    post: {
      id: "post",
      slug: "story",
      version: 1,
      draftDocument: {
        title: "Story",
        excerpt: "",
        authorName: "Team",
        category: null,
        tags: [],
        relatedToolIds: [],
        body: { type: "doc" },
        coverImage,
      },
    },
  };
  const walk = (node) =>
    Array.isArray(node) ? node.flatMap(walk) : node?.props ? [node, ...walk(node.props.children)] : [];
  function render() {
    state.index = 0;
    state.effects = [];
    const nodes = walk(BlogEditor(props));
    for (const effect of state.effects) effect();
    return nodes;
  }
  function unmount() {
    if (state.unmounted) return;
    for (const value of state.values) value?.cleanup?.();
    state.unmounted = true;
  }
  cleanups.push(() => {
    unmount();
    state.runEffects = false;
    createSpy.mockRestore();
    revokeSpy.mockRestore();
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const file = new File(["local image"], "cover.png", { type: "image/png" });
  return {
    render,
    unmount,
    file,
    created,
    revoked,
    select() {
      render()
        .find((node) => node.props["aria-label"] === "Cover image file")
        .props.onChange({
          target: { files: [file], value: "cover.png" },
        });
    },
    async finish(result) {
      finish(result);
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test("a new cover shows its local preview immediately and persists only the completed image", async () => {
  const h = coverUploadHarness();
  h.select();
  const pending = h.render();
  expect(pending.find((node) => node.type === "img").props.src).toBe("blob:cover-preview-1");
  expect(pending.find((node) => node.type === "img").props.srcSet).toBe(undefined);
  expect(pending.find((node) => node.props.id === "blog-add-cover")).toBe(undefined);
  expect(h.created).toEqual([h.file]);
  expect(state.uploads).toEqual([h.file]);
  expect(state.changes.length).toBe(0);
  expect(h.revoked).toEqual([]);

  pending
    .find((node) => node.props.id === "blog-title")
    .props.onChange({ target: { value: "Updated while uploading" } });
  expect(state.changes.at(-1).coverImage).toBe(null);
  await h.finish({ ok: true, data: uploadedCover });
  const delivered = h.render().find((node) => node.type === "img").props;
  expect(delivered.src).toBe(
    "https://res.cloudinary.com/demo/image/upload/c_limit,w_800/q_auto/f_auto/v2/uploaded-cover.png",
  );
  expect(delivered.srcSet).toBe(
    [320, 640, 800]
      .map(
        (width) =>
          `https://res.cloudinary.com/demo/image/upload/c_limit,w_${width}/q_auto/f_auto/v2/uploaded-cover.png ${width}w`,
      )
      .join(", "),
  );
  expect(delivered.sizes).toBeTruthy();
  expect(delivered.width).toBe(800);
  expect(delivered.height).toBe(600);
  expect(state.changes.at(-1).title).toBe("Updated while uploading");
  expect(state.changes.at(-1).coverImage).toEqual(uploadedCover);
  expect(h.revoked).toEqual(["blob:cover-preview-1"]);
  h.unmount();
  expect(h.revoked).toEqual(["blob:cover-preview-1"]);
});

for (const original of [null, savedCover]) {
  test(`failed ${original ? "replacement restores the saved cover" : "first cover restores the upload control"} and releases its preview`, async () => {
    const h = coverUploadHarness(original);
    h.select();
    expect(h.render().find((node) => node.type === "img").props.src).toBe("blob:cover-preview-1");
    await h.finish({ ok: false, message: "Upload failed" });
    const restored = h.render();
    if (original)
      expect(restored.find((node) => node.type === "img").props.src).toBe(
        "https://res.cloudinary.com/demo/image/upload/c_limit,w_800/q_auto/f_auto/v1/saved-cover.png",
      );
    else {
      expect(restored.find((node) => node.type === "img")).toBe(undefined);
      expect(restored.find((node) => node.props.id === "blog-add-cover")).toBeTruthy();
    }
    expect(state.changes.length).toBe(0);
    expect(state.errors).toEqual(["Upload failed"]);
    expect(h.revoked).toEqual(["blob:cover-preview-1"]);
  });
}

test("unmount releases an uploading cover preview and ignores late upload success", async () => {
  const h = coverUploadHarness(savedCover);
  h.select();
  h.render();
  h.unmount();
  expect(h.revoked).toEqual(["blob:cover-preview-1"]);
  await h.finish({ ok: true, data: uploadedCover });
  expect(state.changes.length).toBe(0);
  expect(state.updatesAfterUnmount).toBe(0);
  expect(h.revoked).toEqual(["blob:cover-preview-1"]);
});

test("cover cropping previews locally while pending and retains saved descriptions on completion", async () => {
  const h = coverUploadHarness(savedCover);
  h.render()
    .find((node) => node.type.name === "Button" && [node.props.children].flat().includes("Crop cover"))
    .props.onClick();
  const cropDialog = h.render().find((node) => node.type.name === "BlogImageCropDialog");
  expect(cropDialog.props.src).toBe("https://example.test/saved-cover");
  const applying = cropDialog.props.onApply(h.file);
  expect(h.render().find((node) => node.type === "img").props.src).toBe("blob:cover-preview-1");
  expect(state.changes.length).toBe(0);
  await h.finish({ ok: true, data: uploadedCover });
  await applying;
  expect(state.changes.at(-1).coverImage).toEqual({
    ...uploadedCover,
    alt: savedCover.alt,
    caption: savedCover.caption,
  });
  expect(h.render().find((node) => node.type === "img").props.src).toBe(
    "https://res.cloudinary.com/demo/image/upload/c_limit,w_800/q_auto/f_auto/v2/uploaded-cover.png",
  );
  expect(h.revoked).toEqual(["blob:cover-preview-1"]);
});
