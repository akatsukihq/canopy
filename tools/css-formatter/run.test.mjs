import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import { expect, test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("css-formatter");
import { run } from "./run.ts";
import { JSDOM } from "jsdom";
import { spawnSync } from "node:child_process";

async function execute(text, settings = {}, signal = new AbortController().signal) {
  return run({ input: { text, files: [] }, settings: parseSettings(definition.settings, settings), signal });
}

test("css-formatter: empty and whitespace-only sources produce actionable input errors", async () => {
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
])("css-formatter: %s indentation and property sorting preserve declarations", async (indentWidth, indent) => {
  expect(await execute(".a{z-index:2;color:red;}", { indentWidth })).toEqual({
    render: "text",
    text: `.a {\n${indent}z-index:2;\n${indent}color:red;\n}`,
    downloadName: "formatted.css",
  });
  expect((await execute(".a{z-index:2;color:red;}", { indentWidth, propertyOrder: "alphabetical" })).text).toBe(
    `.a {\n${indent}color:red;\n${indent}z-index:2;\n}`,
  );
});

test.each(["80", "100", "120", "unlimited"])(
  "css-formatter: wrapping at %s columns preserves each value",
  async (printWidth) => {
    const result = await execute(`.a{font-family:${Array(30).fill("Example").join(", ")};}`, { printWidth });
    expect(result.text.match(/Example/g)).toHaveLength(30);
    if (printWidth !== "unlimited")
      for (const line of result.text.split("\n")) expect(line.length).toBeLessThanOrEqual(Number(printWidth));
    else expect(result.text.split("\n").some((line) => line.length > 120)).toBe(true);
  },
);

test("css-formatter: unfinished quoted text is rejected and valid retry succeeds", async () => {
  await expect(execute('const x = "unfinished')).rejects.toMatchObject({ code: "invalid-source" });
  expect((await execute(".a{color:red;}")).text).toContain("color:red");
});

test("css-formatter: comment-like text in quoted content survives formatting", async () => {
  const result = await execute('.label::before { content: "hello  /* literal */ 😀"; }');
  expect(result.text).toContain('content: "hello  /* literal */ 😀";');
});

test("css-formatter: declaration sorting preserves the winning value of duplicate properties", async () => {
  const source = ".example { color: red; color: blue; }";
  const result = await execute(source, { propertyOrder: "alphabetical" });
  function color(css) {
    const dom = new JSDOM(`<style>${css}</style><div class="example">Example</div>`);
    try {
      return dom.window.getComputedStyle(dom.window.document.querySelector(".example")).color;
    } finally {
      dom.window.close();
    }
  }
  expect(color(source)).toBe("rgb(0, 0, 255)");
  expect(color(result.text)).toBe(color(source));
});

test("css-formatter: quoted values and unbreakable tokens finish wrapping without changing content", () => {
  const literal = "value ".repeat(30);
  const token = "a".repeat(140);
  const input = `.example { content: "${literal}"; --token: ${token}; }`;
  // A synchronous wrapping loop can block Vitest's own timeout. Isolate this
  // regression in a bounded child process so the suite can still finish.
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { run } from ${JSON.stringify(new URL("./run.ts", import.meta.url).href)};
    const result = run({ input: { text: ${JSON.stringify(input)} }, settings: ${JSON.stringify(parseSettings(definition.settings, { printWidth: "80" }))}, signal: new AbortController().signal });
    process.stdout.write(JSON.stringify(result));
  `,
    ],
    { encoding: "utf8", timeout: 2_000 },
  );
  expect(child.error, "Wrapping an unbreakable token must finish within two seconds").toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  const result = JSON.parse(child.stdout);
  expect(result.text).toContain(`content: "${literal}";`);
  expect(result.text).toContain(`--token: ${token};`);
});
