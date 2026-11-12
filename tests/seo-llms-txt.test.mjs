import { expect, test } from "vitest";
import { buildLlmsTxt } from "../lib/seo/llmsTxt.ts";

const appUrl = "https://smarttools.example";

test("llms.txt groups public tools by suite with absolute links and descriptions", () => {
  const text = buildLlmsTxt(
    [
      { app: "media", name: "Merge PDF", description: "Combine PDFs.", href: "/media/merge-pdf" },
      { app: "devtools", name: "JSON Formatter", description: "Format JSON.", href: "/devtools/json-formatter" },
      { app: "paperwork", name: "Invoice Generator", description: "Create invoices.", href: "/paperwork/invoice" },
    ],
    appUrl,
  );

  expect(text.startsWith("# SmartTools\n\n> ")).toBe(true);
  const sections = text.split("\n## ").map((section) => section.split("\n")[0]);
  expect(sections.slice(1)).toEqual(["Suites", "Paperwork", "Developer tools", "Media", "Optional"]);
  expect(text).toContain("- [JSON Formatter](https://smarttools.example/devtools/json-formatter): Format JSON.");
  expect(text).toContain("- [Merge PDF](https://smarttools.example/media/merge-pdf): Combine PDFs.");
  expect(text).toContain("](https://smarttools.example/blog/feed.xml)");
});

test("llms.txt keeps stored tool text from breaking its Markdown structure", () => {
  const text = buildLlmsTxt(
    [{ app: "devtools", name: "Bad [name]\n## Injected", description: "Line one\nline two", href: "/devtools/x" }],
    appUrl,
  );
  expect(text).not.toContain("\n## Injected");
  expect(text).toContain("- [Bad \\[name\\] ## Injected](https://smarttools.example/devtools/x): Line one line two");
});

test("llms.txt still lists the suites when the catalog is empty", () => {
  const text = buildLlmsTxt([], appUrl);
  expect(text).toContain("- [Developer tools](https://smarttools.example/devtools)");
  expect(text).not.toContain("\n## Media\n");
});
