import { build } from "esbuild";
import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const source =
  '# A reusable preview\n\nFirst line\nSecond line\n\n![Useful image](./picture.svg)\n\n![Unsafe image](javascript:alert%281%29)\n\n<img src=x onerror="window.injected=true">\n\n- [x] Completed task\n- [ ] Next task\n\n```js\nconst answer = 42;\n```';
let html: string;

test.beforeAll(async () => {
  const root = process.cwd();
  const directory = await mkdtemp(resolve(tmpdir(), "canopy-markdown-component-"));
  const entry = resolve(directory, "entry.tsx");
  await writeFile(
    entry,
    `
    import React, {useCallback,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {MarkdownPreview} from '${root}/components/content/MarkdownPreview.tsx';
    import {RichContent} from '${root}/components/content/RichContent.tsx';
    import {SandboxedHtmlPreview} from '${root}/components/SandboxedHtmlPreview.tsx';
    import {highlightCode} from '${root}/lib/markdown/codeHighlight.ts';
    const sectionText='A full document stays searchable and selectable while distant sections wait to render. '.repeat(12);
    const largeHtml='<h1>Deferred document</h1><p><a href="#last-section">Jump to final section</a></p>'+Array.from({length:400},(_,index)=>'<h2 id="section-'+index+'">Section '+index+'</h2><p>'+sectionText+'</p><pre><code class="language-js">const section = '+index+';\\n  const exact = &quot;&lt;keep &amp; copy&gt;&quot;;  \\n</code></pre>').join('')+'<h2 id="last-section">Final section</h2><p id="search-target">UNIQUE_SEARCHABLE_LAST_SECTION</p><pre><code class="language-js">const finalSection = &quot;complete&quot;;\\n</code></pre>';
    function IframeApp() {
      const [html,setHtml]=useState(largeHtml);
      const [highlighting,setHighlighting]=useState(true);
      const highlight=useCallback(async (code,language)=>{
        window.highlightRequests??=[];
        window.highlightRequests.push(code);
        await new Promise(resolve=>setTimeout(resolve,75));
        return highlightCode(code,language);
      },[]);
      return <main style={{maxWidth:900,margin:'auto',padding:16}}>
        <label><input type="checkbox" checked={highlighting} onChange={event=>setHighlighting(event.target.checked)}/>Enable syntax highlighting</label>
        <button onClick={()=>setHtml('<h1>Replacement document</h1><p>Fresh source</p>')}>Replace preview</button>
        <button onClick={()=>setHtml('')}>Remove preview</button>
        <div style={{display:'flex',height:560}}><SandboxedHtmlPreview html={html} variant="document" preserveScrollAnchor><RichContent html={html} deferSections highlightCode={highlighting?highlight:undefined}/></SandboxedHtmlPreview></div>
      </main>;
    }
    function App() {
      const [markdown,setMarkdown]=useState(${JSON.stringify(source)});
      return <main style={{maxWidth:900,margin:'auto',padding:24}}>
        <label>Preview source<textarea aria-label="Preview source" style={{display:'block',width:'100%',height:100}} value={markdown} onChange={event=>setMarkdown(event.target.value)}/></label>
        <section aria-label="Standalone preview"><MarkdownPreview markdown={markdown}/></section>
        <section aria-label="Configured preview"><MarkdownPreview markdown={'# Host heading\\n\\nFirst line\\nSecond line'} minimumHeadingLevel={2} breaks/></section>
      </main>;
    }
    createRoot(document.getElementById('root')).render(<React.StrictMode>{location.search==='?sandbox'?<IframeApp/>:<App/>}</React.StrictMode>);
  `,
  );
  const bundle = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    outdir: directory,
    absWorkingDir: root,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    nodePaths: [resolve(root, "node_modules")],
    tsconfig: resolve(root, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
    loader: { ".png": "dataurl", ".svg": "dataurl", ".woff2": "dataurl", ".woff": "dataurl", ".ttf": "dataurl" },
  });
  const javascript = bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
  await writeFile("/tmp/canopy-markdown-component.js", javascript);
  const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
  const globals = await postcss([tailwind({ base: root })]).process(
    await readFile(resolve(root, "app/globals.css"), "utf8"),
    { from: resolve(root, "app/globals.css") },
  );
  html = `<!doctype html><html><head><style>${globals.css}\n${css}</style></head><body><div id="root"></div><script>${javascript.replaceAll("</script", "<\\/script")}</script></body></html>`;
});

test("standalone Markdown supports images, safe rendering, multiple instances and streamed replacements", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  const unexpectedRequests: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.stack);
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://markdown.test" });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/picture.svg")
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="100"><rect width="2400" height="100" fill="green"/></svg>',
      });
    unexpectedRequests.push(url.pathname);
    return route.abort();
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("https://markdown.test");
  const preview = page.getByRole("region", { name: "Standalone preview" });
  const configured = page.getByRole("region", { name: "Configured preview" });
  await expect(preview.getByRole("heading", { level: 1 })).toHaveText("A reusable preview");
  await expect(configured.getByRole("heading", { level: 2 })).toHaveText("Host heading");
  await expect(configured.locator("br")).toHaveCount(1);
  await expect(preview.getByAltText("Useful image")).toBeVisible();
  await expect(preview.locator("img")).toHaveCount(1);
  await expect(preview).toContainText("Unsafe image");
  await expect(preview).toContainText('<img src=x onerror="window.injected=true">');
  expect(await page.evaluate(() => (window as Window & { injected?: boolean }).injected)).toBeUndefined();
  await expect(preview.getByRole("checkbox")).toHaveCount(2);
  await preview.getByRole("checkbox", { name: "Completed", exact: true }).click();
  await expect(preview.getByRole("checkbox", { name: "Completed", exact: true })).toBeChecked();
  const copy = preview.getByRole("button", { name: "Copy code", exact: true });
  await copy.focus();
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("const answer = 42;");
  await page.screenshot({ path: "/tmp/canopy-markdown-preview-1366.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(
    await preview
      .getByAltText("Useful image")
      .evaluate((image) => image.getBoundingClientRect().width <= image.parentElement!.getBoundingClientRect().width),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/canopy-markdown-preview-1280.png", fullPage: true });
  await page
    .getByRole("textbox", { name: "Preview source" })
    .fill("```mermaid\nflowchart LR\n A[Input] --> B[Preview]\n```");
  await preview.getByRole("button", { name: "Open Mermaid diagram preview" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "100%", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const markdown of [
    "An **unfinished",
    "## Updated\n\n- [ ] Updated task\n\n```js\nlet changed = 1;\n```",
    "Plain response",
  ]) {
    await page.getByRole("textbox", { name: "Preview source" }).fill(markdown);
    if (markdown === "Plain response") {
      await expect(preview).toHaveText("Plain response");
      await expect(preview.getByRole("checkbox")).toHaveCount(0);
      await expect(preview.getByRole("button")).toHaveCount(0);
    }
  }
  await expect(configured.getByRole("heading", { level: 2 })).toHaveText("Host heading");
  expect(unexpectedRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("large Markdown keeps the full document and enhances controls as their content is reached", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://markdown.test" });
  await page.route("**/*", (route) =>
    route.request().url() === "https://markdown.test/"
      ? route.fulfill({ contentType: "text/html", body: html })
      : route.abort(),
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("https://markdown.test");
  const paragraph = "A complete document retains its **formatted content** and remains searchable. ".repeat(24);
  const markdown = Array.from(
    { length: 1000 },
    (_, index) =>
      `## Section ${index + 1}\n\n${paragraph}\n\n- [x] Reviewed ${index + 1}\n\n\`\`\`js\nconst section = ${index + 1};\n\`\`\`\n`,
  ).join("\n");
  const preview = page.getByRole("region", { name: "Standalone preview" });
  const input = page.getByRole("textbox", { name: "Preview source" });
  await input.evaluate((element, value) => {
    const textarea = element as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, markdown);
  await expect(preview.getByRole("heading", { level: 2 })).toHaveCount(1000);
  await expect(preview.getByRole("heading", { name: "Section 1000", exact: true })).toHaveText("Section 1000");

  await preview.locator("pre").last().scrollIntoViewIfNeeded();
  const copy = preview.getByRole("button", { name: "Copy code", exact: true }).last();
  await expect(copy).toBeInViewport();
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("const section = 1000;");
  await expect(preview.getByRole("checkbox", { name: "Completed", exact: true }).last()).toBeChecked();

  await input.fill("# Replacement\n\nThe large document was replaced.");
  await expect(preview.getByRole("heading", { level: 1 })).toHaveText("Replacement");
  await expect(preview.getByRole("button")).toHaveCount(0);
  await expect(preview.getByRole("checkbox")).toHaveCount(0);
  await expect(preview.locator("pre")).toHaveCount(0);
});

test("deferred iframe keeps search, anchors, selection and code actions stable through scrolling and replacement", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://markdown.test" });
  await page.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("https://markdown.test/?sandbox");
  const preview = page.frameLocator('iframe[title="Generated HTML preview"]');
  await expect(preview.getByRole("heading", { name: "Deferred document", exact: true })).toBeVisible();
  await expect(preview.getByRole("heading", { level: 2 })).toHaveCount(401);
  const finalCode = preview.locator("pre > code").last();
  await expect(finalCode).toHaveText('const finalSection = "complete";\n');
  expect(await finalCode.locator("span").count()).toBe(0);
  expect(
    await page.evaluate(() =>
      ((window as Window & { highlightRequests?: string[] }).highlightRequests ?? []).some((code) =>
        code.includes("finalSection"),
      ),
    ),
  ).toBe(false);

  const frame = page.frames().find((entry) => entry.parentFrame())!;
  expect(
    await frame.evaluate(() =>
      (window as unknown as Window & { find: (text: string) => boolean }).find("UNIQUE_SEARCHABLE_LAST_SECTION"),
    ),
  ).toBe(true);
  await expect(preview.getByText("UNIQUE_SEARCHABLE_LAST_SECTION", { exact: true })).toBeInViewport();
  expect(await frame.evaluate(() => window.getSelection()?.toString())).toBe("UNIQUE_SEARCHABLE_LAST_SECTION");
  await finalCode.scrollIntoViewIfNeeded();
  await expect.poll(() => finalCode.locator("span").count()).toBeGreaterThan(0);
  const copy = preview.getByRole("button", { name: "Copy code", exact: true }).last();
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('const finalSection = "complete";\n');

  for (const section of [200, 20, 300, 40]) {
    const heading = preview.getByRole("heading", { name: `Section ${section}`, exact: true });
    await heading.evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
    await expect(heading).toBeInViewport();
    await expect
      .poll(() =>
        heading.evaluate((element) =>
          Math.abs(element.getBoundingClientRect().top - parseFloat(getComputedStyle(element).scrollMarginTop)),
        ),
      )
      .toBeLessThan(4);
    const before = await heading.evaluate((element) => element.getBoundingClientRect().top);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    expect(Math.abs((await heading.evaluate((element) => element.getBoundingClientRect().top)) - before)).toBeLessThan(
      4,
    );
  }

  await frame.evaluate(() => {
    document.scrollingElement!.scrollTop = 0;
  });
  await preview.getByRole("link", { name: "Jump to final section" }).click();
  await expect(preview.getByRole("heading", { name: "Final section", exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("checkbox", { name: "Enable syntax highlighting" }).uncheck();
  await expect(finalCode.locator("span")).toHaveCount(0);
  await expect(finalCode).toHaveText('const finalSection = "complete";\n');

  await page.getByRole("checkbox", { name: "Enable syntax highlighting" }).check();
  await page.getByRole("button", { name: "Replace preview", exact: true }).click();
  await expect(preview.getByRole("heading", { name: "Replacement document", exact: true })).toBeVisible();
  await expect(preview.locator("pre")).toHaveCount(0);
  await expect(preview.getByRole("button")).toHaveCount(0);
  await page.getByRole("button", { name: "Remove preview", exact: true }).click();
  await expect(preview.locator("body")).toHaveText("");
  expect(errors).toEqual([]);
});
