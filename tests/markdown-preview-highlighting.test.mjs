import { toolSpec } from "./helpers/toolSpec.mjs";
import { describe, expect, test } from "vitest";
import { highlightCode, createCodeHighlightBudget } from "../lib/markdown/codeHighlight.ts";
import { parseSettings } from "../lib/tool-framework/settings.ts";
const definition = await toolSpec("markdown-previewer");
import { run, renderMarkdownPreview } from "../tools/markdown-previewer/run.worker.ts";

async function preview(markdown, settings = {}) {
  const result = await run({
    input: { text: markdown },
    settings: parseSettings(definition.settings, settings),
    signal: new AbortController().signal,
  });
  expect(result.render).toBe("html");
  expect(result.downloadName).toBe("preview.html");
  return result.html;
}

function fenced(code, language = "") {
  return `\`\`\`${language}\n${code}\n\`\`\``;
}

function codeBody(html) {
  const match = html.match(/<pre><code(?: [^>]*)?>([\s\S]*?)<\/code><\/pre>/);
  expect(match, "the result must contain a code block").toBeTruthy();
  return match[1];
}

function codeText(html) {
  return codeBody(html)
    .replace(/<span\b[^>]*>|<\/span>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[entity]);
}

test("default display defers coloring to the highlight worker while preserving the code", async () => {
  const html = await preview(fenced('const answer = "ready";', "js"));
  // The per-keystroke render worker no longer evaluates lowlight; it emits plain,
  // exact code and flags the block for the persistent highlight worker to color.
  expect(codeBody(html)).not.toMatch(/<span\b/);
  expect(codeText(html)).toBe('const answer = "ready";\n');
  // Color correctness is applied post-paint by the highlight worker via highlightCode.
  expect(highlightCode('const answer = "ready";', "js")).toMatch(/<span class="hljs-keyword">const<\/span>/);
  expect(highlightCode('const answer = "ready";', "js")).toMatch(/<span class="hljs-string">/);
});

test("the render worker flags code blocks for deferred highlighting", async () => {
  const result = await run({
    input: { text: fenced('const answer = "ready";', "js") },
    settings: parseSettings(definition.settings, {}),
    signal: new AbortController().signal,
  });
  expect(result.deferCodeHighlighting).toBe(true);
});

describe("language aliases produce the same highlighting as the blog viewer", () => {
  const cases = [
    ["javascript", "js", 'const answer = "ready"; // result'],
    ["python", "py", 'def greet(name):\n    return f"Hello {name}"'],
    ["json", "json", '{"enabled": true, "count": 42}'],
  ];
  for (const [language, alias, code] of cases) {
    test(language, () => {
      // The highlight worker resolves the fence label through highlightCode, so an
      // alias must produce the same colored markup as its canonical language name.
      for (const label of [language, alias, alias.toUpperCase()]) {
        expect(highlightCode(code, label)).toBe(highlightCode(code, language));
        expect(highlightCode(code, label)).toMatch(/<span class="hljs-/);
      }
    });
  }
});

test("unlabelled and unknown-language fences use automatic highlighting", () => {
  const code = "def double(value):\n    return value * 2";
  for (const language of ["", "not-a-language"]) {
    expect(highlightCode(code, language || undefined)).toBe(highlightCode(code));
  }
  expect(highlightCode(code)).toMatch(/<span class="hljs-/);
});

test("plain-text fences and Mermaid source remain unhighlighted", async () => {
  for (const language of ["text", "plaintext", "txt", "mermaid", "MERMAID"]) {
    const code = language.toLowerCase() === "mermaid" ? "flowchart LR\n    A --> B" : 'const text = "plain";';
    const html = await preview(fenced(code, language), { syntaxHighlighting: true });
    expect(codeBody(html)).not.toMatch(/<span\b/);
    expect(codeText(html)).toBe(`${code}\n`);
  }
});

test("turning highlighting off preserves the code without token markup", async () => {
  const code = 'const message = "<ready>";\n  // keep this indentation';
  const html = await preview(fenced(code, "js"), { syntaxHighlighting: false });
  expect(codeBody(html)).not.toMatch(/<span\b/);
  expect(codeText(html)).toBe(`${code}\n`);
});

test("highlighting preserves blank lines, tabs, and trailing spaces", async () => {
  const code = '\nfunction greet() {\n\tconst label = "hello";  \n\n\treturn label;\n}';
  const html = await preview(fenced(code, "js"), { syntaxHighlighting: true });
  expect(codeText(html)).toBe(`${code}\n`);
});

test("code content and language labels cannot inject HTML", async () => {
  const code = '<script>alert("x")</script>\n<img src=x onerror="alert(1)">\n& < > " \'';
  for (const language of ["html", 'js\"><img/src=x/onerror=alert(1)>']) {
    for (const syntaxHighlighting of [true, false]) {
      const html = await preview(fenced(code, language), { syntaxHighlighting });
      expect(html).not.toMatch(/<script\b|<img\b|<svg\b|<[^>]+\sonerror=/i);
      expect(codeText(html)).toBe(`${code}\n`);
    }
  }
});

test("safe links remain independent of syntax highlighting", async () => {
  const markdown = `${fenced("const count = 1;", "js")}\n\n[Docs](https://example.com)`;
  for (const syntaxHighlighting of [true, false]) {
    const safe = await preview(markdown, { syntaxHighlighting, safeLinks: true });
    expect(safe).toMatch(/<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">Docs<\/a>/);
    const standard = await preview(markdown, { syntaxHighlighting, safeLinks: false });
    expect(standard).toMatch(/<a href="https:\/\/example\.com">Docs<\/a>/);
  }
});

test("large code blocks fall back to complete escaped text before expensive highlighting", () => {
  for (const [language, repetitions] of [
    [undefined, 150],
    ["unknown-language", 150],
    ["js", 2400],
  ]) {
    const code = 'const message = "<keep every line>";\n'.repeat(repetitions);
    const html = highlightCode(code, language);
    expect(html).not.toMatch(/<span\b/);
    expect(html).toBe(
      code.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
    );
  }
});

test("a shared document budget leaves later code complete when its highlighting allowance is exhausted", () => {
  const code = "const result = 42;";
  const budget = { remainingChars: code.length };
  expect(highlightCode(code, "js", budget)).toMatch(/hljs-keyword/);
  expect(highlightCode(code, "js", budget)).toBe(code);
  expect(highlightCode(code, "js", createCodeHighlightBudget())).toMatch(/hljs-keyword/);
});

test("an oversized block does not spend the allowance for subsequent small code", () => {
  const budget = { remainingChars: 100 };
  const oversized = "x".repeat(70_000);
  expect(highlightCode(oversized, "js", budget)).toBe(oversized);
  expect(highlightCode("const answer = 42;", "js", budget)).toMatch(/hljs-keyword/);
});

test("large previews defer colors while retaining the complete document and full highlighted export", async () => {
  const source = `${"A complete paragraph.\n\n".repeat(5000)}${fenced('const last = "<preserved>";', "js")}\n\n# Final section`;
  const settings = parseSettings(definition.settings, {});
  const result = await renderMarkdownPreview(source, settings);
  expect(result.deferCodeHighlighting).toBe(true);
  expect(result.html).toMatch(/<h1>Final section<\/h1>/);
  expect((result.html.match(/A complete paragraph\./g) ?? []).length).toBe(5000);
  expect(codeText(result.html)).toBe('const last = "<preserved>";\n');
  expect(codeBody(result.html)).not.toMatch(/<span\b/);

  const exported = await renderMarkdownPreview(source, settings, { deferHighlighting: false });
  expect(exported.deferCodeHighlighting).toBe(undefined);
  expect(codeBody(exported.html)).toMatch(/hljs-keyword/);
  expect(codeText(exported.html)).toBe(codeText(result.html));
  expect(exported.html).toMatch(/<h1>Final section<\/h1>/);
  expect((exported.html.match(/A complete paragraph\./g) ?? []).length).toBe(5000);
});

test("disabled highlighting remains plain for large preview and explicit export requests", async () => {
  const source = `${"Paragraph.\n\n".repeat(9000)}${fenced("const value = 1;", "js")}`;
  for (const deferHighlighting of [undefined, false, true]) {
    const result = await renderMarkdownPreview(
      source,
      parseSettings(definition.settings, { syntaxHighlighting: false }),
      { deferHighlighting },
    );
    expect(result.deferCodeHighlighting).toBe(undefined);
    expect(codeBody(result.html)).not.toMatch(/<span\b/);
    expect(codeText(result.html)).toBe("const value = 1;\n");
  }
});

test("full exports honor the document highlighting budget without losing later code", async () => {
  const code = "const answer = 42;\n".repeat(3000);
  const source = Array.from({ length: 6 }, () => fenced(code, "js")).join("\n\n");
  const result = await renderMarkdownPreview(source, parseSettings(definition.settings, {}), {
    deferHighlighting: false,
  });
  const blocks = [...result.html.matchAll(/<pre><code(?: [^>]*)?>([\s\S]*?)<\/code><\/pre>/g)].map((match) => match[1]);
  expect(blocks.length).toBe(6);
  expect(blocks[0]).toMatch(/hljs-keyword/);
  expect(blocks.at(-1)).toBe(code);
  expect((result.html.replace(/<[^>]*>/g, "").match(/const answer = 42;/g) ?? []).length).toBe(18_000);
});

test("Markdown rendering rejects a canceled run before processing", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    renderMarkdownPreview("# Canceled", parseSettings(definition.settings, {}), undefined, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});
