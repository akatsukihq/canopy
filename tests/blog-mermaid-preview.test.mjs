import { afterAll, expect, test, vi } from "vitest";

const state = { values: [], index: 0, png: async () => {}, errors: [] };
globalThis.__blogMermaidTest = state;

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal()),
  useState: (initial) => {
    const s = globalThis.__blogMermaidTest;
    const i = s.index++;
    if (!(i in s.values)) s.values[i] = initial;
    return [s.values[i], (value) => (s.values[i] = value)];
  },
  useEffect: () => {},
}));
vi.mock("@/components/ui/index.tsx", () => ({
  Button: "button",
  ActionMenuButton: "action-menu",
  DropdownMenuItem: "menu-item",
  Tooltip: "tooltip",
  TooltipContent: "tooltip-content",
  TooltipProvider: "provider",
  TooltipTrigger: "trigger",
  Popover: { Root: "popover", Trigger: "trigger", Portal: "portal", Content: "content", Close: "close" },
  toast: {
    error(message) {
      globalThis.__blogMermaidTest.errors.push(message);
    },
  },
}));
vi.mock("@/lib/markdown/diagramExport", () => ({
  diagramPng: (svg) => globalThis.__blogMermaidTest.png(svg),
}));
vi.mock("../components/content/MermaidPreview", () => ({ MermaidPreview: "full-preview" }));

const { MermaidDiagram } = await import("../components/content/MermaidDiagram.tsx");
afterAll(() => {
  delete globalThis.__blogMermaidTest;
});
const walk = (node) =>
  Array.isArray(node) ? node.flatMap(walk) : node?.props ? [node, ...walk(node.props.children)] : [];
const source = "flowchart LR\n A[Upload] --> B[Download]";
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text>A &amp; B</text></svg>';
function render(previewable = true) {
  state.index = 0;
  return walk(MermaidDiagram({ source, previewable }));
}
test("only read-view diagrams open a preview with exact SVG/source downloads and can close", () => {
  state.values = [{ source, svg }, false];
  expect(render(false).some((node) => node.type === "button")).toBe(false);
  const button = render().find((node) => node.props["aria-label"] === "Open Mermaid diagram preview");
  button.props.onClick();
  const preview = render().find((node) => node.type === "full-preview");
  expect(preview.props.svg).toBe(svg);
  const links = walk(preview.props.downloads).filter((node) => node.type === "a");
  expect(
    links.map((node) => [node.props.download, decodeURIComponent(node.props.href.split(",").slice(1).join(","))]),
  ).toEqual([
    ["diagram.svg", svg],
    ["diagram.mmd", source],
  ]);
  preview.props.onClose();
  expect(render().some((node) => node.type === "full-preview")).toBe(false);
  state.values = [{ source, error: "Invalid diagram" }, false];
  expect(render().some((node) => node.type === "button")).toBe(false);
});

test("PNG export reports loading and offers recovery when rendering fails", async () => {
  state.values = [{ source, svg }, true, false];
  state.errors = [];
  state.png = async () => {
    throw new Error("Canvas unavailable");
  };
  const downloadNodes = () => walk(render().find((node) => node.type === "full-preview").props.downloads);
  downloadNodes()
    .find((node) => node.type === "menu-item" && node.props.children === "Download PNG")
    .props.onSelect();
  expect(downloadNodes().find((node) => node.type === "action-menu").props.loading).toBe(true);
  await new Promise((resolve) => setImmediate(resolve));
  expect(state.errors).toEqual(["PNG download failed. Try again or download SVG."]);
  expect(downloadNodes().find((node) => node.type === "action-menu").props.loading).toBe(false);
  expect(downloadNodes().find((node) => node.props.children === "Download PNG").props.disabled).toBe(false);
});
