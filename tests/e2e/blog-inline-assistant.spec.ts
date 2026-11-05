import { build } from "esbuild";
import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const root = process.cwd();
const original = "A clear introduction helps readers understand the article.";
let javascript: string, stylesheet: string;

test.beforeAll(async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "canopy-inline-harness-"));
  const entry = resolve(directory, "entry.tsx");
  await writeFile(
    entry,
    `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { EditorContent, useEditor } from '@tiptap/react';
    import StarterKit from '@tiptap/starter-kit';
    import { BlogSelectionToolbar } from '${root}/app/admin/(protected)/blog/components/BlogSelectionToolbar.tsx';
    import { Toaster } from '${root}/components/ui/index.tsx';
    import content from '${root}/components/content/content.module.css';
    const body = {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:${JSON.stringify(original)}}]},{type:'paragraph',content:[{type:'text',text:'Another paragraph stays unchanged while you review the suggestion.'}]}]};
    function App() {
      const [document,setDocument] = useState({schemaVersion:1,title:'Freelance invoice guide',excerpt:'',authorName:'Editor',coverImage:null,category:null,tags:[],seoTitle:null,seoDescription:null,body});
      const editor = useEditor({extensions:[StarterKit],content:body,editorProps:{attributes:{role:'textbox','aria-label':'Article body',class:content.content+' min-h-0 outline-none'}},onUpdate:({editor})=>setDocument(value=>({...value,body:editor.getJSON()}))});
      window.inlineEditor = editor;
      return <><main className="platform-shell" style={{height:'100vh',background:'var(--card)',padding:'24px',overflow:'auto'}} data-blog-editor-scroll><article style={{maxWidth:850,margin:'100px auto'}}><h1 style={{fontSize:32,fontWeight:600,marginBottom:28}}>Freelance invoice guide</h1><EditorContent editor={editor}/><BlogSelectionToolbar editor={editor} postId="fixture-post"/></article></main><Toaster/></>;
    }
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
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
    loader: { ".png": "dataurl", ".svg": "dataurl", ".woff2": "dataurl" },
  });
  javascript = bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
  const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
  const globals = await postcss([tailwind({ base: root })]).process(
    await readFile(resolve(root, "app/globals.css"), "utf8"),
    { from: resolve(root, "app/globals.css") },
  );
  stylesheet = globals.css + "\n" + css;
  if (process.env.INLINE_HARNESS_FONT) {
    const font = (await readFile(process.env.INLINE_HARNESS_FONT)).toString("base64");
    stylesheet += `@font-face{font-family:Geist;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format("woff2");}`;
  }
});

type RequestRecord = { method: string; path: string; body: Record<string, unknown> | null };
async function harness(page: Page) {
  page.on("pageerror", (error) => console.log("HARNESS PAGE ERROR", error.message));
  const requests: RequestRecord[] = [];
  const runs = new Map<string, Record<string, unknown>>();
  let holding = false;
  let releaseHeld = () => {};
  const control = {
    get hold() {
      return holding;
    },
    set hold(value: boolean) {
      holding = value;
      if (!value) releaseHeld();
    },
    fail: false,
    networkAbort: false,
    holdSubmission: false,
    releaseSubmission: () => {},
    candidate: "Readers understand your article when its introduction is clear.",
  };
  await page.route("**/*", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><style>${stylesheet}</style></head><body><div id="root"></div><script>${javascript.replaceAll("</script", "<\\/script")}</script></body></html>`,
      });
    const body = request.postDataJSON() as Record<string, unknown> | null;
    requests.push({ method: request.method(), path, body });
    if (path === "/api/assistant/blog/runs" && request.method() === "POST") {
      if (control.networkAbort) {
        control.networkAbort = false;
        return route.abort("aborted");
      }
      if (control.fail) {
        control.fail = false;
        return route.fulfill({ status: 503, json: { error: "Temporary provider failure" } });
      }
      const id = `run-${runs.size + 1}`,
        selection = { text: (body!.context as { selectedText: string }).selectedText };
      const run = {
        id,
        resourceId: "fixture-post",
        integrationKey: "blog",
        executionMode: "conversational",
        threadId: "inline-thread",
        inputMessageId: "input-message",
        assistantMessageId: `assistant-${id}`,
        operation: "rewrite",
        provider: "fixture",
        model: "fixture",
        status: "queued",
        request: body,
        response: null,
        errorMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
      };
      runs.set(id, {
        ...run,
        status: "completed",
        response: {
          text: "Review this edit",
          citations: [],
          data: { keywords: [], findings: [], searchStatus: "not_requested" },
          proposals: [
            {
              id: "rewrite",
              status: "pending",
              data: {
                type: "edit",
                originalText: selection.text,
                replacement: [{ type: "paragraph", content: [{ type: "text", text: control.candidate }] }],
              },
            },
          ],
        },
      });
      if (control.holdSubmission)
        await new Promise<void>((resolve) => {
          control.releaseSubmission = resolve;
        });
      if (control.hold)
        await new Promise<void>((resolve) => {
          releaseHeld = resolve;
        });
      return route.fulfill({
        contentType: "application/x-ndjson",
        body:
          [
            { type: "run", run },
            { type: "text", text: control.candidate },
            { type: "completed", run: runs.get(id) },
          ]
            .map((event) => JSON.stringify(event))
            .join("\n") + "\n",
      });
    }
    const id = path.split("/")[5],
      run = runs.get(id);
    if (path.includes("/proposals/")) return route.fulfill({ json: { run } });
    if (run)
      return route.fulfill({ json: { run: control.hold ? { ...run, status: "running", response: null } : run } });
    return route.fulfill({ status: 404, json: { error: "Unexpected harness request" } });
  });
  await page.goto("https://inline-harness.test/");
  const editor = page.getByRole("textbox", { name: "Article body", exact: true });
  await expect(editor).toContainText(original);
  return { editor, requests, control };
}
async function selectAndOpen(page: Page) {
  await page
    .getByRole("textbox", { name: "Article body", exact: true })
    .locator("p")
    .first()
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      (element.closest('[contenteditable="true"]') as HTMLElement).focus();
    });
  await page.getByRole("button", { name: "Improve selected text", exact: true }).click();
}
async function capture(page: Page, path: string) {
  await page.screenshot({ path });
  const dialog = page.locator('[role="dialog"], [data-blog-improve-menu][role="menu"]').first();
  console.log(
    "INLINE GEOMETRY",
    JSON.stringify({ path, viewport: page.viewportSize(), dialog: await dialog.boundingBox() }),
  );
}
function assertPrivate(requests: RequestRecord[]) {
  expect(requests.some((request) => request.path.includes("threads"))).toBe(false);
  for (const request of requests.filter((request) => request.method === "POST" && request.path.endsWith("/runs"))) {
    expect(request.body?.operation).toBe("rewrite");
    expect(request.body).not.toHaveProperty("document");
    expect(request.body).not.toHaveProperty("version");
    expect(request.body).not.toHaveProperty("selection");
    expect((request.body?.context as { selectedText: string })?.selectedText).toBe(original);
    expect(request.body?.context).not.toHaveProperty("editorJson");
    expect(request.body?.context).not.toHaveProperty("document");
  }
}

test("Improve uses a neutral trigger and a keyboard-accessible tone flyout", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { editor, requests } = await harness(page);
  await selectAndOpen(page);
  const improve = page.getByRole("button", { name: "Improve selected text", exact: true });
  await page.mouse.move(20, 20);
  await expect(improve).toHaveCSS("background-color", "rgb(232, 240, 255)");
  const tone = page.getByRole("menuitem", { name: "Adjust tone", exact: true });
  await tone.hover();
  const professional = page.getByRole("menuitem", { name: "Professional", exact: true });
  await expect(professional).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Reduce text", exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/blog-inline-tone-flyout-1366.png" });
  await professional.focus();
  await professional.press("ArrowLeft");
  await expect(professional).toBeHidden();
  await expect(tone).toBeFocused();
  await tone.press("ArrowRight");
  await expect(professional).toBeVisible();
  await expect(professional).toBeFocused();
  await professional.press("Escape");
  await expect(tone).toBeHidden();
  await page.mouse.move(20, 20);
  await expect(improve).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await improve.click();
  await tone.hover();
  await professional.click();
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
  await expect(editor.locator("p").first()).toHaveText(original);
  expect(requests.find((request) => request.method === "POST")?.body?.message).toBe("Change the tone to professional");
  assertPrivate(requests);
});

test("inline heading choices reflect the current block and undo as one edit", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { editor, requests } = await harness(page);
  await selectAndOpen(page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Text style", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Text style", exact: true });
  await expect(menu.getByRole("button", { name: "Paragraph", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Paragraph", "Heading 2", "Heading 3", "Heading 4", "Heading 5", "Heading 6"])
    await expect(menu.getByRole("button", { name, exact: true })).toBeVisible();
  await menu.getByRole("button", { name: "Heading 3", exact: true }).click();
  await expect(editor.locator("h3")).toHaveText(original);
  await editor.press("ControlOrMeta+z");
  await expect(editor.locator("p").first()).toHaveText(original);
  await expect(editor.locator("h3")).toHaveCount(0);
  await page.evaluate("window.inlineEditor.chain().setTextSelection({from:1,to:58}).setHeading({level:2}).run()");
  await page.getByRole("button", { name: "Text style", exact: true }).click();
  await expect(menu.getByRole("button", { name: "Heading 2", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(menu.getByRole("button", { name: "Paragraph", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({ path: "/tmp/blog-inline-heading-menu.png" });
  expect(requests).toHaveLength(0);
});

test("inline actions retain the anchored text until Accept and support Undo", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { editor, requests, control } = await harness(page);
  control.hold = true;
  await selectAndOpen(page);
  for (const name of [
    "Adjust tone",
    "Fix spelling & grammar",
    "Extend text",
    "Reduce text",
    "Simplify text",
    "Emojify",
    "Ask AI…",
    "Complete sentence",
  ])
    await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
  await capture(page, "/tmp/blog-inline-menu-1366.png");
  await page.getByRole("menuitem", { name: "Reduce text", exact: true }).click();
  await expect(page.getByText("AI AT WORK", { exact: true }))
    .toBeVisible()
    .catch(async (error) => {
      console.log(
        "INLINE DIAGNOSTIC",
        requests,
        await page.locator('[role="dialog"]').evaluateAll((elements) =>
          elements.map((element) => ({
            text: element.textContent,
            style: element.getAttribute("style"),
            rect: element.getBoundingClientRect().toJSON(),
          })),
        ),
      );
      throw error;
    });
  await expect(editor.locator("p").first()).toHaveText(original);
  await capture(page, "/tmp/blog-inline-working-1366.png");
  control.hold = false;
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
  await expect(editor.locator("p").first()).toHaveText(original);
  await page.setViewportSize({ width: 1280, height: 720 });
  await capture(page, "/tmp/blog-inline-candidate-1280.png");
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(editor.locator("p").first()).toHaveText(control.candidate);
  await expect(editor.locator("p").last()).toHaveText(
    "Another paragraph stays unchanged while you review the suggestion.",
  );
  await expect(page.getByText("Change applied", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByText("Change applied", { exact: true })).toBeInViewport({ ratio: 1 });
  console.log(
    "APPLIED TOAST",
    await page.getByText("Change applied", { exact: true }).boundingBox(),
    await page.getByRole("button", { name: "Undo", exact: true }).boundingBox(),
  );
  await page.screenshot({ path: "/tmp/blog-inline-applied-1366.png" });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.locator("p").first()).toHaveText(original);
  await page.evaluate("window.inlineEditor.commands.setTextSelection(1)");
  await selectAndOpen(page);
  // The accepted-selection highlight expires after900ms; that cleanup must not hide a later toolbar.
  await page.waitForTimeout(1000);
  await expect(page.getByRole("menuitem", { name: "Adjust tone", exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Assistant" })).toHaveCount(0);
  assertPrivate(requests);
});

test("retry keeps the candidate, Discard preserves article, and Ask AI is one line", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { editor, requests, control } = await harness(page);
  await selectAndOpen(page);
  await page.getByRole("menuitem", { name: "Ask AI…", exact: true }).click();
  const prompt = page.getByRole("textbox", { name: "AI instruction" });
  await expect(prompt).toHaveJSProperty("tagName", "INPUT");
  await prompt.fill("Make this clearer");
  await expect(prompt).toBeFocused();
  const selected = editor.locator("span").filter({ hasText: original });
  await expect(selected).toHaveCSS("background-color", "rgb(232, 240, 255)");
  await expect
    .poll(async () => {
      const selection = await selected.boundingBox();
      const dialog = await page.getByRole("dialog", { name: "Ask AI", exact: true }).boundingBox();
      return !!selection && !!dialog && dialog.y >= selection.y + selection.height;
    })
    .toBe(true);
  await capture(page, "/tmp/blog-inline-prompt-1366.png");
  await prompt.press("Enter");
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
  const first = control.candidate;
  control.hold = true;
  control.fail = true;
  control.candidate = "A second clear candidate.";
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.getByText(first, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeDisabled();
  await capture(page, "/tmp/blog-inline-retry-failure-1366.png");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("AI AT WORK", { exact: true })).toBeVisible();
  await expect(editor.locator("p").first()).toHaveText(original);
  control.hold = false;
  await expect(page.getByText(control.candidate, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(editor.locator("p").first()).toHaveText(original);
  expect(
    await page.evaluate(
      "window.inlineEditor.state.doc.textBetween(window.inlineEditor.state.selection.from,window.inlineEditor.state.selection.to)",
    ),
  ).toBe(original);
  assertPrivate(requests);
});

test("cancelling before acknowledgement aborts presentation without applying late output", async ({ page }) => {
  const { editor, requests, control } = await harness(page);
  control.holdSubmission = true;
  await selectAndOpen(page);
  await page.getByRole("menuitem", { name: "Simplify text", exact: true }).click();
  await expect.poll(() => requests.filter((request) => request.path.endsWith("/runs")).length).toBe(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  control.releaseSubmission();
  expect(requests.filter((request) => request.path.endsWith("/runs"))).toHaveLength(1);
  await expect(editor.locator("p").first()).toHaveText(original);
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      "window.inlineEditor.state.doc.textBetween(window.inlineEditor.state.selection.from,window.inlineEditor.state.selection.to)",
    ),
  ).toBe(original);
  assertPrivate(requests);
});

test("failed submission retries the same request and edited passages block stale acceptance", async ({ page }) => {
  const { editor, requests, control } = await harness(page);
  control.fail = true;
  await selectAndOpen(page);
  await page.getByRole("menuitem", { name: "Fix spelling & grammar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.getByText("AI AT WORK", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Inline AI suggestion", { exact: true })).toHaveAttribute("aria-busy", "false");
  await expect(editor.locator("p").first()).toHaveText(original);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
  const sent = requests.filter((request) => request.path.endsWith("/runs"));
  expect(sent[0].body?.clientRequestId).toBe(sent[1].body?.clientRequestId);
  await page.evaluate("window.inlineEditor.commands.insertContentAt({from:1,to:2}, 'Changed ')");
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
  await expect(editor).toContainText("Changed ");
  assertPrivate(requests);
});

test("development effect replay leaves one live inline request that completes", async ({ page }) => {
  const { editor, requests, control } = await harness(page);
  control.hold = true;
  await selectAndOpen(page);
  await page.getByRole("menuitem", { name: "Simplify text", exact: true }).click();
  await expect(page.getByText("AI AT WORK", { exact: true })).toBeVisible();
  await expect.poll(() => requests.filter((request) => request.path.endsWith("/runs")).length).toBe(1);
  control.hold = false;
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
  await expect(page.getByText("AI AT WORK", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Inline AI suggestion", { exact: true })).toHaveAttribute("aria-busy", "false");
  await expect(editor.locator("p").first()).toHaveText(original);
  expect(requests.filter((request) => request.path.endsWith("/runs"))).toHaveLength(1);
});

test("network cancellation exits the working state and can be retried", async ({ page }) => {
  const { editor, requests, control } = await harness(page);
  control.networkAbort = true;
  await selectAndOpen(page);
  await page.getByRole("menuitem", { name: "Simplify text", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.getByText("AI AT WORK", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Inline AI suggestion", { exact: true })).toHaveAttribute("aria-busy", "false");
  await expect(editor.locator("p").first()).toHaveText(original);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
  const sent = requests.filter((request) => request.path.endsWith("/runs"));
  expect(sent).toHaveLength(2);
  expect(sent[0].body?.clientRequestId).toBe(sent[1].body?.clientRequestId);
});

test("inline suggestions remain reachable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { editor, requests, control } = await harness(page);
  await selectAndOpen(page);
  for (const name of ["Adjust tone", "Reduce text", "Ask AI…"]) {
    const bounds = await page.getByRole("menuitem", { name, exact: true }).boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("menuitem", { name: "Simplify text", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
  await capture(page, "/tmp/blog-inline-candidate-mobile.png");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeInViewport({ ratio: 1 });
  control.candidate = "A longer replacement remains readable while you decide whether to accept it. ".repeat(120);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText(control.candidate.trim(), { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Discard", exact: true })).toBeInViewport({ ratio: 1 });
  await capture(page, "/tmp/blog-inline-long-candidate-mobile.png");
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(editor.locator("p").first()).toHaveText(original);
  assertPrivate(requests);
});

test("deselecting while inline generation is pending aborts it without applying late output", async ({ page }) => {
  const { editor, requests, control } = await harness(page);
  control.hold = true;
  await selectAndOpen(page);
  await page.getByRole("menuitem", { name: "Simplify text", exact: true }).click();
  await expect(page.getByText("AI AT WORK", { exact: true })).toBeVisible();
  await editor
    .locator("p")
    .last()
    .click({ position: { x: 750, y: 10 } });
  await expect(page.getByText("AI AT WORK", { exact: true })).toHaveCount(0);
  control.hold = false;
  await expect(editor.locator("p").first()).toHaveText(original);
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
  assertPrivate(requests);
});
