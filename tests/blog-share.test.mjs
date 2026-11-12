import { setImmediate, setTimeout as wait } from "node:timers/promises";
import { expect, onTestFinished, test, vi } from "vitest";

const state = { values: [], index: 0, errors: [], timer: { current: null } };
globalThis.__blogShareTest = state;

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal()),
  useState: (initial) => {
    const s = globalThis.__blogShareTest;
    const i = s.index++;
    if (!(i in s.values)) s.values[i] = initial;
    return [s.values[i], (value) => (s.values[i] = value)];
  },
  useRef: () => globalThis.__blogShareTest.timer,
  useEffect: () => {},
}));
// The component is called as a plain function, so supply real English messages without a provider.
vi.mock("next-intl", async (importOriginal) => {
  const { createTranslator } = await importOriginal();
  const { getCommonMessages } = await import("../lib/i18n/messages.ts");
  return {
    useTranslations: (namespace) => createTranslator({ locale: "en", messages: getCommonMessages("en"), namespace }),
  };
});
vi.mock("@/components/ui/index.tsx", () => ({
  Button: "button",
  Input: "input",
  Label: "label",
  Tooltip: "tooltip",
  TooltipContent: "tooltip-content",
  TooltipProvider: "tooltip-provider",
  TooltipTrigger: "tooltip-trigger",
  Popover: { Root: "popover", Trigger: "popover-trigger", Portal: "portal", Content: "dialog" },
  toast: {
    error(message) {
      globalThis.__blogShareTest.errors.push(message);
    },
  },
}));

const { CopyBlogLink } = await import("../components/blog/CopyBlogLink.tsx");
const walk = (node) =>
  Array.isArray(node) ? node.flatMap(walk) : node?.props ? [node, ...walk(node.props.children)] : [];
const url = "https://example.com/blog/a-guide";
const title = "A guide & a better workflow";
const render = () => {
  state.index = 0;
  return walk(CopyBlogLink({ url, title }));
};
const copyButton = () =>
  render().find((n) => n.type === "button" && /Copy article link|Link copied/.test(n.props["aria-label"] ?? "")).props;
const shareButton = () =>
  render().find((n) => n.type === "button" && Array.isArray(n.props.children) && n.props.children.includes("Share"))
    .props;
const announcement = () => render().find((n) => n.props.role === "status").props.children;

test("article sharing copies the canonical URL, resets feedback, and recovers from clipboard and native-share failures", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const copied = [];
  const navigator = {
    clipboard: {
      async writeText(value) {
        copied.push(value);
      },
    },
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigator });
  onTestFinished(() => {
    clearTimeout(state.timer.current);
    delete globalThis.__blogShareTest;
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  });
  copyButton().onClick();
  await setImmediate();
  expect(copied).toEqual([url]);
  expect(announcement()).toMatch(/Link copied/);
  await wait(2050);
  expect(announcement()).toBe("");
  navigator.clipboard.writeText = async () => {
    throw new Error("Denied");
  };
  copyButton().onClick();
  await setImmediate();
  expect(announcement()).toMatch(/Select and copy/);
  expect(render().find((n) => n.type === "popover").props.open).toBe(true);
  expect(render().find((n) => n.type === "input").props.value).toBe(url);
  expect(state.errors.at(-1)).toMatch(/Couldn[’']t copy/);
  const mail = render().find((n) => n.type === "a").props.href;
  expect(mail).toBe(`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`);
  navigator.clipboard.writeText = async (value) => copied.push(value);
  copyButton().onClick();
  await setImmediate();
  expect(announcement()).toMatch(/Link copied/);
  const shared = [];
  navigator.share = async (data) => shared.push(data);
  let prevented = false;
  shareButton().onClick({
    preventDefault() {
      prevented = true;
    },
  });
  await setImmediate();
  expect(prevented).toBe(true);
  expect(shared).toEqual([{ title, url }]);
  const errorCount = state.errors.length;
  navigator.share = async () => {
    throw new DOMException("Cancelled", "AbortError");
  };
  shareButton().onClick({ preventDefault() {} });
  await setImmediate();
  expect(state.errors.length).toBe(errorCount);
  navigator.share = async () => {
    throw new Error("Unavailable");
  };
  shareButton().onClick({ preventDefault() {} });
  await setImmediate();
  expect(render().find((n) => n.type === "popover").props.open).toBe(true);
  expect(state.errors.at(-1)).toMatch(/share by email/);
  delete navigator.share;
  prevented = false;
  shareButton().onClick({
    preventDefault() {
      prevented = true;
    },
  });
  expect(prevented, "Unsupported native sharing leaves the accessible popover trigger active").toBe(false);
});
