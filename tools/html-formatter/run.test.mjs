import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test } from "vitest";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("html-formatter");
import { run } from "./run.ts";

async function execute(text, settings = {}, signal = new AbortController().signal) {
  return run({ input: { text, files: [] }, settings: parseSettings(definition.settings, settings), signal });
}

test("html-formatter: empty and whitespace-only sources produce actionable input errors", async () => {
  for (const input of ["", " \t\n"]) {
    await expect(execute(input)).rejects.toMatchObject({
      code: "input-required",
      message: expect.stringMatching(/input|source/i),
    });
  }
});

test.each([
  ["2", "  "],
  ["4", "    "],
  ["tab", "\t"],
])("html-formatter: %s indentation preserves Unicode and void elements", async (indentWidth, indent) => {
  expect(await execute('<div><img src="x"><p>café 😀</p></div>', { indentWidth })).toEqual({
    render: "text",
    text: `<div>\n${indent}<img src="x">\n${indent}<p>\n${indent}${indent}café 😀\n${indent}</p>\n</div>`,
    downloadName: "formatted.html",
  });
});

test.each(["80", "100", "120", "unlimited"])(
  "html-formatter: print width %s controls long attributes",
  async (printWidth) => {
    const source = `<a href="/${"x".repeat(130)}" class="link">go</a>`;
    const result = await execute(source, { printWidth });
    expect(result.text).toContain(`href="/${"x".repeat(130)}"`);
    expect(result.text.startsWith("<a\n")).toBe(printWidth !== "unlimited");
  },
);

test.each([
  ["auto", false],
  ["preserve", false],
  ["one-per-line", true],
])("html-formatter: %s attribute policy", async (attributeWrapping, wrapped) => {
  const result = await execute('<input id="name" required>', { attributeWrapping });
  expect(result.text).toBe(wrapped ? '<input\n  id="name"\n  required\n>' : '<input id="name" required>');
});

test("html-formatter: script text retains its evaluated string value", async () => {
  const source = '<script>const label = "A > < B  C"; label;</script>';
  const result = await execute(source);
  const script = JSDOM.fragment(result.text).querySelector("script");
  expect(script).not.toBeNull();
  expect(runInNewContext(script.textContent, Object.create(null), { timeout: 1000 })).toBe("A > < B  C");
});

test("html-formatter: style text preserves whitespace and angle brackets inside a CSS string", async () => {
  const result = await execute('<style>.label::before { content: "A > < B  C"; }</style>');
  const style = JSDOM.fragment(result.text).querySelector("style");
  expect(style).not.toBeNull();
  expect(style.textContent).toContain('content: "A > < B  C";');
});

test("html-formatter: preformatted text preserves leading, repeated, and trailing whitespace", async () => {
  const content = " first\n  second  😀\n";
  const result = await execute(`<pre>${content}</pre>`);
  expect(JSDOM.fragment(result.text).querySelector("pre").textContent).toBe(content);
});

test("html-formatter: quoted angle brackets remain part of attribute values", async () => {
  const result = await execute('<div title="A > B" data-label="C < D">Text</div>');
  const element = JSDOM.fragment(result.text).querySelector("div");
  expect(element.getAttribute("title")).toBe("A > B");
  expect(element.getAttribute("data-label")).toBe("C < D");
  expect(element.textContent.trim()).toBe("Text");
});

test("html-formatter: textarea content and quoted raw-element attributes are preserved", async () => {
  const content = " first\n  second  😀\n";
  const result = await execute(`<div><textarea data-label="A > B">${content}</textarea></div>`);
  const textarea = JSDOM.fragment(result.text).querySelector("textarea");
  expect(textarea.getAttribute("data-label")).toBe("A > B");
  expect(textarea.value).toBe(content);
});
