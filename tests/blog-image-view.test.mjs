import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { history, undo } from "@tiptap/pm/history";
import { EditorState } from "@tiptap/pm/state";
import { expect, onTestFinished, test, vi } from "vitest";
import { BlogImageNode } from "@/app/admin/(protected)/blog/lib/imageNode.ts";

const componentState = {
  values: [],
  index: 0,
  effects: [],
  dirty: false,
  unmounted: false,
  updatesAfterUnmount: 0,
};
globalThis.__blogImageViewTest = componentState;

// Fake React hooks so the component can be hand-rendered; JSX still uses the real
// react/jsx-runtime, which returns walkable element objects.
vi.mock("react", () => {
  const store = () => globalThis.__blogImageViewTest;
  function useState(initial) {
    const s = store();
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
  function useId() {
    return "image-test";
  }
  function useEffect(callback, deps) {
    const s = store();
    const i = s.index++;
    const previous = s.values[i];
    if (!previous || !deps || deps.some((value, j) => !Object.is(value, previous.deps[j]))) {
      s.values[i] = { deps, cleanup: previous?.cleanup };
      s.effects.push(() => {
        previous?.cleanup?.();
        s.values[i].cleanup = callback();
      });
    }
  }
  const mod = { useState, useRef, useId, useEffect };
  return { ...mod, default: mod };
});
vi.mock("@tiptap/react", () => ({ NodeViewWrapper: () => {} }));
vi.mock("@/components/ui/index.tsx", () => ({
  Button: () => {},
  Input: () => {},
  Label: () => {},
  Tooltip: () => {},
  TooltipContent: () => {},
  TooltipProvider: () => {},
  TooltipTrigger: () => {},
  Popover: { Root() {}, Anchor() {}, Portal() {}, Content() {} },
}));
vi.mock("@/app/admin/(protected)/blog/components/BlogImageCropDialog.tsx", () => ({
  BlogImageCropDialog: () => null,
}));

const { BlogImageView, resizedImageWidth, uploadBlogImageReplacement } =
  await import("@/app/admin/(protected)/blog/components/BlogImageView.tsx");

test("image resizing follows its anchored edge and stays within the document width", () => {
  expect(resizedImageWidth(50, 80, 800, "left")).toBe(60);
  expect(resizedImageWidth(50, -80, 800, "left")).toBe(40);
  expect(resizedImageWidth(50, 80, 800, "center")).toBe(70);
  expect(resizedImageWidth(50, -80, 800, "center")).toBe(30);
  expect(resizedImageWidth(50, -80, 800, "right")).toBe(60);
  expect(resizedImageWidth(50, 80, 800, "right")).toBe(40);
  expect(resizedImageWidth(50, 99999, 800, "left")).toBe(100);
  expect(resizedImageWidth(50, -99999, 800, "left")).toBe(10);
  expect(resizedImageWidth(50, 3, 800, "left")).toBe(50);
  expect(resizedImageWidth(50, 4, 800, "left")).toBe(51);
  expect(resizedImageWidth(50, 100, 0, "center")).toBe(50);
});

const media = (publicId, version, width, height) => ({
  v: 1,
  provider: "cloudinary",
  format: "png",
  width,
  height,
  uploadedAt: "2026-01-01T00:00:00.000Z",
  entry: { cloudName: "demo", publicId, version },
});
const source = {
  media: media("smarttools/blog/original", 1, 800, 600),
  alt: "Original description",
  caption: "Original caption",
  displayWidth: 45,
  alignment: "right",
};
const cropped = {
  media: media("smarttools/blog/cropped", 2, 400, 300),
  alt: "",
  caption: "",
};
const schema = getSchema([StarterKit, BlogImageNode]);
function imageEditor() {
  let state = EditorState.create({
    doc: schema.node("doc", null, [schema.node("image", source)]),
    plugins: [history()],
  });
  const dispatch = (transaction) => {
    state = state.apply(transaction);
  };
  const editor = {
    isEditable: true,
    isDestroyed: false,
    get state() {
      return state;
    },
    view: { dispatch },
  };
  return {
    editor,
    getPos: () => 0,
    updateAttributes: (attrs) =>
      dispatch(state.tr.setNodeMarkup(0, undefined, { ...state.doc.nodeAt(0).attrs, ...attrs })),
  };
}

function imageViewHarness(selected = false) {
  Object.assign(componentState, {
    values: [],
    index: 0,
    effects: [],
    dirty: false,
    unmounted: false,
    updatesAfterUnmount: 0,
  });
  const base = imageEditor();
  const calls = { select: 0, focus: 0, changes: 0 };
  const listeners = new Map();
  const props = {
    ...base,
    node: base.editor.state.doc.nodeAt(0),
    selected,
    extension: { options: { onUploadImage: async () => cropped } },
    updateAttributes(attrs) {
      calls.changes++;
      base.updateAttributes(attrs);
      props.node = base.editor.state.doc.nodeAt(0);
    },
    deleteNode() {},
  };
  props.editor.commands = {
    setNodeSelection() {
      calls.select++;
      props.selected = true;
    },
    focus() {
      calls.focus++;
    },
  };
  props.editor.view.focus = () => {
    calls.focus++;
  };
  props.editor.on = (event, listener) => listeners.set(event, listener);
  props.editor.off = (event) => listeners.delete(event);
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const document = { activeElement: null };
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  const walk = (node) =>
    Array.isArray(node) ? node.flatMap(walk) : node?.props ? [node, ...walk(node.props.children)] : [];
  function render() {
    let nodes;
    for (let pass = 0; pass < 10; pass++) {
      componentState.index = 0;
      componentState.dirty = false;
      componentState.effects = [];
      nodes = walk(BlogImageView(props));
      for (const effect of componentState.effects) effect();
      if (!componentState.dirty)
        return {
          root: nodes.find((node) => node.type.name === "Root").props,
          figure: nodes.find((node) => node.type === "figure").props,
          image: nodes.find((node) => node.type === "img").props,
          button: nodes.find((node) => node.props["aria-label"]?.startsWith("Edit image:")).props,
          panel: nodes.find((node) => node.props["aria-label"] === "Image settings").props,
          resize: nodes.find((node) => node.props.role === "slider")?.props,
          wrapper: nodes.find((node) => node.type.name === "NodeViewWrapper").props,
        };
    }
    expect.fail("Image view did not settle after its effects");
  }
  function unmount() {
    if (componentState.unmounted) return;
    for (const value of componentState.values) value?.cleanup?.();
    componentState.unmounted = true;
  }
  onTestFinished(() => {
    unmount();
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
    vi.useRealTimers();
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return { render, props, calls, document, unmount };
}

test("image hover shows settings without selecting or editing and bridges to focused controls", () => {
  const h = imageViewHarness();
  expect(h.render().root.open).toBe(false);
  h.render().figure.onPointerEnter({ pointerType: "mouse" });
  expect(h.render().root.open).toBe(true);
  let autofocusPrevented = false;
  h.render().panel.onOpenAutoFocus({
    preventDefault() {
      autofocusPrevented = true;
    },
  });
  expect(autofocusPrevented).toBe(true);
  expect(h.calls).toEqual({ select: 0, focus: 0, changes: 0 });

  h.render().figure.onPointerLeave();
  vi.advanceTimersByTime(100);
  h.render().panel.onPointerEnter();
  vi.advanceTimersByTime(250);
  expect(h.render().root.open).toBe(true);
  const field = {};
  h.render().panel.ref.current = { contains: (node) => node === field };
  h.document.activeElement = field;
  h.render().panel.onFocusCapture();
  h.render().panel.onPointerLeave();
  vi.advanceTimersByTime(250);
  expect(h.render().root.open).toBe(true);
  h.document.activeElement = null;
  h.render().panel.onBlurCapture();
  vi.advanceTimersByTime(250);
  expect(h.render().root.open).toBe(false);
  expect(h.calls).toEqual({ select: 0, focus: 0, changes: 0 });

  h.render().figure.onPointerEnter({ pointerType: "touch" });
  expect(h.render().root.open).toBe(false);
  h.render().button.onClick();
  expect(h.render().root.open).toBe(true);
  expect(h.calls).toEqual({ select: 1, focus: 1, changes: 0 });
  h.render().root.onOpenChange(false);
  expect(h.render().root.open).toBe(false);
  h.props.node = h.props.editor.state.doc.nodeAt(0);
  expect(h.render().root.open).toBe(false);
  h.render().figure.onPointerEnter({ pointerType: "mouse" });
  expect(h.render().root.open).toBe(true);
  h.render().panel.onEscapeKeyDown();
  h.render().root.onOpenChange(false);
  expect(h.render().root.open).toBe(false);
  h.render().button.onFocus();
  expect(h.render().root.open).toBe(true);
  h.render().root.onOpenChange(false);
  h.props.selected = false;
  h.render();
  h.props.selected = true;
  expect(h.render().root.open).toBe(true);
});

test("image drag dismisses controls, resizing keeps them open, and unmount cancels hover work", () => {
  const h = imageViewHarness();
  h.render().figure.onPointerEnter({ pointerType: "mouse" });
  expect(h.render().root.open).toBe(true);
  h.render().image.onDragStart();
  expect(h.render().root.open).toBe(false);
  h.props.selected = true;
  expect(h.render().root.open).toBe(false);
  h.render().figure.onPointerEnter({ pointerType: "mouse" });
  expect(h.render().root.open).toBe(false);
  h.render().image.onDragEnd();
  h.render().button.onClick();
  expect(h.render().root.open).toBe(true);
  h.render().wrapper.ref.current = { getBoundingClientRect: () => ({ width: 800 }) };
  const event = {
    pointerId: 1,
    button: 0,
    clientX: 100,
    preventDefault() {},
    stopPropagation() {},
    currentTarget: {
      setPointerCapture() {},
      hasPointerCapture: () => true,
      releasePointerCapture() {},
    },
  };
  h.render().resize.onPointerDown(event);
  h.render().figure.onPointerLeave();
  vi.advanceTimersByTime(300);
  expect(h.render().root.open).toBe(true);
  h.render().resize.onPointerMove({ ...event, clientX: 60 });
  h.render().resize.onPointerUp(event);
  expect(h.calls.changes).toBe(1);
  expect(h.props.editor.state.doc.nodeAt(0).attrs.displayWidth).toBe(50);

  h.render().figure.onPointerEnter({ pointerType: "mouse" });
  h.render().figure.onPointerLeave();
  h.unmount();
  vi.advanceTimersByTime(1000);
  expect(componentState.updatesAfterUnmount).toBe(0);
});

test("cropping uploads a new image, preserves current descriptions and layout, and undoes independently", async () => {
  const props = imageEditor();
  props.updateAttributes({ caption: "Updated caption" });
  const beforeCrop = props.editor.state.doc.toJSON();
  const file = new File(["cropped"], "crop.png", { type: "image/png" });
  let uploaded;
  await uploadBlogImageReplacement(
    file,
    source.media,
    props,
    async (input) => {
      uploaded = input;
      return cropped;
    },
    () => true,
  );
  expect(uploaded).toBe(file);
  expect({ ...props.editor.state.doc.nodeAt(0).attrs }).toEqual({
    ...cropped,
    alt: source.alt,
    caption: "Updated caption",
    displayWidth: 45,
    alignment: "right",
  });
  expect(undo(props.editor.state, props.editor.view.dispatch)).toBe(true);
  expect(props.editor.state.doc.toJSON()).toEqual(beforeCrop);
  expect(undo(props.editor.state, props.editor.view.dispatch)).toBe(true);
  expect(props.editor.state.doc.nodeAt(0).attrs.caption).toBe(source.caption);
});

test("failed uploads leave the current inline image unchanged and reject for retry", async () => {
  for (const upload of [
    async () => null,
    async () => {
      throw new Error("Offline");
    },
  ]) {
    const props = imageEditor();
    const original = props.editor.state.doc.toJSON();
    await expect(
      uploadBlogImageReplacement(new File(["crop"], "crop.png"), source.media, props, upload, () => true),
    ).rejects.toThrow();
    expect(props.editor.state.doc.toJSON()).toEqual(original);
  }
});

test("cropping refuses stale, removed, read-only and unmounted inline images before and after upload", async () => {
  for (const timing of ["before", "during"]) {
    for (const invalidate of [
      (props) => props.updateAttributes({ media: media("smarttools/blog/another-image", 1, 800, 600) }),
      (props) => props.updateAttributes({ media: media("smarttools/blog/original", 10, 800, 600) }),
      (props) =>
        props.updateAttributes({ media: { ...source.media, entry: { ...source.media.entry, cloudName: "other" } } }),
      (props) => {
        props.removed = true;
      },
      (props) => {
        props.editor.view.dispatch(props.editor.state.tr.delete(0, 1));
      },
      (props) => {
        props.editor.isEditable = false;
      },
      (props) => {
        props.editor.isDestroyed = true;
      },
      (props) => {
        props.mounted = false;
      },
    ]) {
      const props = { ...imageEditor(), mounted: true };
      props.getPos = () => (props.removed ? undefined : 0);
      if (timing === "before") invalidate(props);
      let uploads = 0;
      let expected = props.editor.state.doc.toJSON();
      await expect(
        uploadBlogImageReplacement(
          new File(["crop"], "crop.png"),
          source.media,
          props,
          async () => {
            uploads++;
            if (timing === "during") invalidate(props);
            expected = props.editor.state.doc.toJSON();
            return cropped;
          },
          () => props.mounted,
        ),
      ).rejects.toThrow();
      expect(uploads).toBe(timing === "before" ? 0 : 1);
      expect(props.editor.state.doc.toJSON()).toEqual(expected);
    }
  }
});
