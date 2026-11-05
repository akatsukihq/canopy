import { build } from "esbuild";
import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

let html: string;
test.beforeAll(async () => {
  const root = process.cwd();
  const directory = await mkdtemp(resolve(tmpdir(), "canopy-chat-stream-"));
  const entry = resolve(directory, "entry.tsx");
  await writeFile(
    entry,
    `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {EditorContent,useEditor} from '@tiptap/react'; import StarterKit from '@tiptap/starter-kit';
    import {BlogAssistantPanel} from '${root}/app/admin/(protected)/blog/components/BlogAssistantPanel.tsx';
    import {BlogEditorShell} from '${root}/app/admin/(protected)/blog/components/BlogEditorShell.tsx';
    import {Toaster} from '${root}/components/ui/index.tsx';
    const document={schemaVersion:1,title:'A practical invoicing guide',excerpt:'',authorName:'Editor',coverImage:null,category:null,tags:[],seoTitle:null,seoDescription:null,body:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'A clear introduction helps readers understand the article.'}]}]}};
    document.body = (window as Window & {proposalDocument?: typeof document.body}).proposalDocument ?? document.body;
    import {agentDocumentFingerprint} from '${root}/lib/blog/agentArtifacts.ts';
    window.agentDocumentFingerprint = agentDocumentFingerprint;
    window.initialAgentDocument = document;
    document.relatedToolIds = [];
    function App(){const [draft,setDraft]=React.useState(document);const current=React.useRef(draft);current.current=draft;const editor=useEditor({extensions:[StarterKit],content:document.body,onUpdate:({editor})=>setDraft({...current.current,body:editor.getJSON()}),editorProps:{attributes:{role:'textbox','aria-label':'Article body'}}});return <main className="platform-shell" style={{height:'100vh'}}><BlogEditorShell title={draft.title} initialAssistantOpen status="Draft" saveState="saved" canEdit toolbar={null} settings={null} onSave={()=>{}} onPreview={()=>{}} onReview={()=>{}} assistant={(onClose)=><BlogAssistantPanel postId="post" ownerId="owner" editor={editor} document={draft} onMetadata={()=>{}} onReplaceDocument={next=>{editor.commands.setContent(next.body,{emitUpdate:false});setDraft(next)}} onClose={onClose}/>}><h2 className="text-heading-1">{draft.title}</h2><EditorContent editor={editor}/></BlogEditorShell><Toaster/></main>};createRoot(window.document.getElementById('root')).render(<App/>);

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
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".png": "dataurl", ".svg": "dataurl", ".woff2": "dataurl", ".woff": "dataurl", ".ttf": "dataurl" },
  });
  const javascript = bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
  const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
  const globals = await postcss([tailwind({ base: root })]).process(
    await readFile(resolve(root, "app/globals.css"), "utf8"),
    { from: resolve(root, "app/globals.css") },
  );
  let fonts = "";
  try {
    const chunks = resolve(root, ".next/dev/static/chunks");
    const fontStylesheet = (await readdir(chunks)).find(
      (name) =>
        name.startsWith("[next]_internal_font_google_geist_") && !name.includes("geist_mono") && name.endsWith(".css"),
    );
    if (fontStylesheet) {
      fonts = await readFile(resolve(chunks, fontStylesheet), "utf8");
      for (const match of fonts.matchAll(/url\("(\.\.\/media\/[^" ]+\.woff2)"\)/g)) {
        const data = (await readFile(resolve(chunks, match[1]))).toString("base64");
        fonts = fonts.replace(match[0], `url("data:font/woff2;base64,${data}")`);
      }
    }
  } catch {
    /* The harness also runs without Next's optional local font cache. */
  }
  html = `<!doctype html><html><head><style>${fonts}\n${globals.css}\n${css}</style></head><body><div id="root"></div><script>${javascript.replaceAll("</script", "<\\/script")}</script></body></html>`;
  await writeFile("/tmp/canopy-agent-harness.html", html);
});

test("four agents produce saved artifacts, explicit handoffs and approved reversible drafts", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => (errors.push(error.message), console.log("AGENT PAGE ERROR", error.message)));
  await page.setViewportSize({ width: 1366, height: 768 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://agents.test" });
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const availability = {
      enabled: true,
      provider: "fixture",
      capabilities: { images: true, structuredOutput: true, webSearch: false, urlRetrieval: false },
    };
    const thread = {
      id: "thread-1",
      resourceId: "post",
      integrationKey: "blog",
      title: "Editorial work",
      type: "chat",
      settings: {},
      composerDraft: "",
      composerState: { attachmentIds: [] },
      createdAt: now,
      updatedAt: now,
    };
    const restored = JSON.parse(sessionStorage.getItem("mock-agent-data") ?? "{}");
    const executions: Record<string, unknown>[] = restored.executions ?? [],
      attachments: Record<string, unknown>[] = restored.attachments ?? [
        {
          id: "source-link",
          type: "link",
          threadId: thread.id,
          messageId: "source-message",
          runId: null,
          label: "Invoicing reference",
          status: "ready",
          data: { url: "https://example.com/invoices" },
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          createdAt: now,
          updatedAt: now,
        },
      ],
      runs: Record<string, unknown>[] = restored.runs ?? [];
    const fixture = {
      requests: [] as Record<string, unknown>[],
      attachmentRequests: [] as string[],
      complete: () => {},
      fail: () => {},
      interrupt: () => {},
      thread,
    };
    Object.assign(window, { agentFixture: fixture, process: { env: { NODE_ENV: "production" } } });
    window.fetch = async (input, init) => {
      const url = String(input),
        method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      if (url.includes("/attachments/") || url.includes("/attachments?")) fixture.attachmentRequests.push(url);
      if (url === "/api/assistant/blog/config") return Response.json(availability);
      if (url.endsWith("/threads?resourceId=post")) return Response.json({ threads: [thread] });
      if (url.includes("/attachments/")) {
        const attachment = attachments.find((item) => item.id === url.split("/").at(-1));
        return attachment
          ? Response.json({ attachment, html: "<p>This complete replacement makes the guide easier to follow.</p>" })
          : Response.json({ error: "Attachment unavailable" }, { status: 404 });
      }
      if (url.includes("/attachments?") && url.includes("cursor=older-source"))
        return Response.json({
          attachments: [
            attachments[0],
            {
              ...attachments[0],
              id: "older-source",
              label: "Earlier reference",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          nextCursor: null,
        });
      if (url.includes("/attachments?"))
        return Response.json({
          attachments: url.includes("kind=artifacts")
            ? attachments
                .filter((item) => item.type === "artifact")
                .map((item) => ({
                  ...item,
                  data: { artifactSummary: (item.data as Record<string, unknown>).artifact },
                }))
            : attachments.filter((item) => item.type !== "artifact"),
          nextCursor:
            url.includes("kind=sources") && attachments.some((item) => item.type !== "artifact")
              ? "older-source"
              : null,
        });
      if (url.endsWith("/thread-1")) {
        if (method === "PATCH") Object.assign(thread, body);
        return Response.json({
          thread,
          runs: [],
          executions,
          messages: [],
          attachments,
          executionsCursor: null,
          ...availability,
        });
      }
      if (url.startsWith("/api/assistant/blog/runs/"))
        return Response.json({ run: runs.find((run) => run.id === url.split("/").at(-1)) });
      if (url === "/api/assistant/blog/runs") {
        fixture.requests.push(body);
        const id = `run-${runs.length + 1}`;
        const run = {
          id,
          threadId: thread.id,
          resourceId: "post",
          integrationKey: "blog",
          operation: "agent",
          executionMode: "standalone",
          status: "running",
          provider: "fixture",
          model: "fixture",
          inputMessageId: null,
          assistantMessageId: null,
          request: body,
          response: null as unknown,
          errorMessage: null,
          createdAt: new Date().toISOString(),
          updatedAt: now,
          completedAt: null as string | null,
        };
        runs.push(run);
        const summary = {
          id,
          agentId: body.agentId,
          requestMessage: body.message,
          operation: "agent",
          executionMode: "standalone",
          status: "running",
          label: "Agent request",
          createdAt: run.createdAt,
          updatedAt: now,
          completedAt: null as string | null,
          errorMessage: null,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          artifact: undefined as unknown,
        };
        executions.push(summary);
        const stream = new ReadableStream({
          start(controller) {
            const event = (data: unknown) => controller.enqueue(new TextEncoder().encode(JSON.stringify(data) + "\n"));
            event({ type: "run", run });
            fixture.complete = () => {
              const article = {
                ...body.context?.document,
                title: "A complete optimized guide",
                excerpt: "A clearer guide.",
                seoTitle: "Practical invoice guide",
                seoDescription: "Learn the essentials.",
                body: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "This complete replacement makes the guide easier to follow." }],
                    },
                  ],
                },
              };
              const content =
                body.agentId === "planner"
                  ? {
                      sections: [
                        {
                          heading: "Article outline",
                          text: "Start with the reader’s task.",
                          items: ["Invoice essentials", "Payment instructions"],
                        },
                      ],
                    }
                  : body.agentId === "auditor"
                    ? {
                        sections: [
                          {
                            heading: "Clarity",
                            text: "One actionable issue.",
                            findings: [
                              {
                                severity: "high",
                                passage: "A clear introduction",
                                issue: "Give a concrete starting point",
                                recommendation: "Lead with the first action.",
                              },
                            ],
                          },
                        ],
                      }
                    : {
                        document: article,
                        changes: ["Clarified the introduction"],
                        keywords: [{ keyword: "invoice guide", kind: "primary", rationale: "Matches the task" }],
                        remainingTasks: ["Confirm facts before publishing"],
                      };
              const fingerprint = (window as unknown as { agentDocumentFingerprint: (value: unknown) => string })
                .agentDocumentFingerprint;
              const artifact = {
                schemaVersion: 1,
                agentId: body.agentId,
                agentVersion: 1,
                summary: `${body.agentId} completed the requested work.`,
                content,
                inputArtifactIds: body.attachmentIds ?? [],
                baseDocumentFingerprint: body.context?.document ? fingerprint(body.context?.document) : undefined,
              };
              const attachment = {
                id: `artifact-${id}`,
                runId: id,
                threadId: thread.id,
                messageId: null,
                type: "artifact",
                label: `${body.agentId} result`,
                status: "ready",
                data: { artifact },
                expiresAt: summary.expiresAt,
                createdAt: run.createdAt,
                updatedAt: now,
              };
              attachments.push(attachment);
              const reference = {
                attachmentId: attachment.id,
                label: attachment.label,
                agentId: body.agentId,
                summary: artifact.summary,
                baseDocumentFingerprint: artifact.baseDocumentFingerprint,
              };
              run.status = "completed";
              run.completedAt = new Date(Date.parse(run.createdAt) + 72_000).toISOString();
              run.updatedAt = run.completedAt;
              run.response = {
                text: "",
                keywords: [],
                findings: [],
                proposals: [],
                citations: [],
                searchStatus: "not_requested",
                artifact: reference,
              };
              Object.assign(summary, {
                status: "completed",
                completedAt: run.completedAt,
                updatedAt: run.updatedAt,
                artifact: reference,
              });
              sessionStorage.setItem("mock-agent-data", JSON.stringify({ executions, attachments, runs }));
              event({ type: "completed", run });
              controller.close();
            };
            fixture.interrupt = () => {
              controller.close();
            };
            fixture.fail = () => {
              run.status = "failed";
              Object.assign(summary, { status: "failed", errorMessage: "Fixture failure" });
              event({ type: "error", run, message: "Fixture failure" });
              controller.close();
            };
            init?.signal?.addEventListener("abort", () => {
              run.status = "cancelled";
              summary.status = "cancelled";
              try {
                controller.close();
              } catch {}
            });
          },
        });
        return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
      }
      throw new Error(`Unexpected request ${method} ${url}`);
    };
  });
  await page.route("https://agents.test/", (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("https://agents.test/");
  const panel = page.getByRole("complementary", { name: "Assistant" });
  const composer = panel.getByRole("combobox", { name: "Message to assistant" });
  await expect(composer).toBeVisible();
  await composer.fill("Keep this draft while the panel slides.");
  const assistantTrigger = page
    .getByRole("group", { name: "Editor panels" })
    .getByRole("button", { name: "Assistant", exact: true });
  const assistantElement = page.locator("#blog-assistant");
  await panel.getByRole("button", { name: "Close assistant", exact: true }).click();
  await expect(assistantTrigger).toBeFocused();
  await expect(assistantElement).toHaveAttribute("inert", "");
  await expect(assistantElement).toBeHidden();
  await assistantTrigger.click();
  await expect(composer).toHaveText("Keep this draft while the panel slides.");
  await page.getByRole("button", { name: "Post settings", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Post settings", exact: true })).toBeVisible();
  await assistantTrigger.click();
  await expect(composer).toHaveText("Keep this draft while the panel slides.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await panel.getByRole("button", { name: "Close assistant", exact: true }).click();
  await expect(assistantElement).toBeHidden();
  await assistantTrigger.click();
  await expect(composer).toHaveText("Keep this draft while the panel slides.");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await composer.fill("");
  await expect(panel.getByRole("tab", { name: "Review", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("region", { name: "Start a conversation" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Open previous report" })).toHaveCount(0);
  await composer.fill("Before /plan after");
  for (let i = 0; i < 6; i++) await composer.press("ArrowLeft");
  await expect(panel.getByRole("option", { name: /Planner/ })).toBeVisible();
  await composer.press("Enter");
  await expect(composer).toContainText("Before Planner after");
  await composer.pressSequentially("middle");
  await expect(composer).toContainText("Before Plannermiddle after");
  await panel.getByRole("button", { name: "Remove agent" }).click();
  await expect(composer).toHaveText("Before middle after");
  await composer.press("ControlOrMeta+z");
  await expect(panel.getByRole("button", { name: "Remove agent" })).toBeVisible();
  await composer.press("ControlOrMeta+b");
  await composer.pressSequentially(" bold");
  await composer.press("ControlOrMeta+b");
  await expect(composer.locator("strong")).toContainText("bold");
  await page.screenshot({ path: "/tmp/blog-composer-inline-rich.png" });
  await page.reload();
  await expect(composer).toContainText("Planner");
  await expect(composer.locator("strong")).toContainText("bold");
  await composer.press("ControlOrMeta+a");
  const formatting = page.getByRole("toolbar", { name: "Message formatting" });
  await formatting.getByRole("button", { name: "Italic", exact: true }).click();
  await expect(composer.locator("em").first()).toBeVisible();
  await composer.press("ControlOrMeta+a");
  await formatting.getByRole("button", { name: "Bullet list", exact: true }).click();
  await expect(composer.locator("ul li").first()).toBeVisible();
  await page.reload();
  await expect(composer.locator("ul li").first()).toBeVisible();
  await composer.fill("linked text");
  await composer.press("ControlOrMeta+a");
  await formatting.getByRole("button", { name: "Edit message link" }).click();
  await page.getByRole("textbox", { name: "URL", exact: true }).fill("https://example.com/reference");
  await page.getByRole("button", { name: "Add link", exact: true }).click();
  await expect(composer.getByRole("link", { name: "linked text" })).toHaveAttribute(
    "href",
    "https://example.com/reference",
  );
  await page.reload();
  await expect(composer.getByRole("link", { name: "linked text" })).toBeVisible();
  await composer.fill("x".repeat(8001));
  await expect(panel.getByText("Shorten the message to 8,000 characters or simplify its formatting.")).toBeVisible();
  await composer.fill("Notes");
  await composer.press("Shift+Enter");
  await expect(composer).toContainText("Notes");
  await composer.fill("https://example.com/a");
  await expect(panel.getByRole("listbox", { name: "Agents" })).toHaveCount(0);
  await composer.fill("/");
  const agentPicker = panel.getByRole("listbox", { name: "Agents" });
  await expect(agentPicker.getByRole("option")).toHaveCount(4);
  for (const name of ["Planner", "Writer", "Auditor", "Optimizer"])
    await expect(agentPicker.getByRole("option", { name: new RegExp(name) })).toBeVisible();
  await page.screenshot({ path: "/tmp/blog-agents-picker-1366.png" });
  await composer.fill("/upload");
  await expect(agentPicker.getByRole("option")).toHaveCount(0);
  await composer.fill("/unknown");
  await expect(panel.getByText("No matching agents")).toBeVisible();
  await composer.press("Enter");
  await expect(composer).toHaveText("/unknown");
  await composer.press("Escape");
  await expect(panel.getByRole("listbox", { name: "Agents" })).toHaveCount(0);
  await composer.fill("/plan");
  await expect(panel.getByRole("listbox", { name: "Agents" })).toBeVisible();
  await composer.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(panel.getByRole("listbox", { name: "Agents" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Remove agent" })).toHaveCount(0);
  await composer.press("Enter");
  await expect(panel.getByRole("button", { name: "Remove agent" })).toBeVisible();
  await expect(composer).toContainText("Planner");
  await composer.pressSequentially("Outline this guide for beginners");
  await panel.getByRole("button", { name: "Remove current context" }).click();
  await page.screenshot({ path: "/tmp/blog-agents-composer-1366.png" });
  await panel.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(panel.getByText("Working with Planner…")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { agentFixture: { requests: Record<string, unknown>[] } }).agentFixture.requests[0]
          .document,
    ),
  ).toBeUndefined();
  await expect(panel.getByRole("button", { name: "Open planner result" })).toHaveCount(0);
  await composer.fill("Keep this new instruction");
  await page.evaluate(() => (window as unknown as { agentFixture: { complete: () => void } }).agentFixture.complete());
  await expect(panel.getByRole("button", { name: "Open planner result" })).toBeVisible();
  await expect(composer).toContainText("Keep this new instruction");
  const plannerActivity = panel.locator('[data-agent-run="run-1"]');
  await expect(plannerActivity.getByLabel("Request to Planner")).toContainText("Outline this guide for beginners");
  await plannerActivity.getByRole("button", { name: "View activity" }).click();
  await expect(plannerActivity.getByText("Request accepted", { exact: true })).toBeVisible();
  await expect(plannerActivity.getByText("Completed in 1m 12s", { exact: true })).toBeVisible();
  await panel.screenshot({ path: "/tmp/blog-agents-activity-panel.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(plannerActivity.getByText("Completed in 1m 12s", { exact: true })).toBeVisible();
  await panel.screenshot({ path: "/tmp/blog-agents-activity-panel-1280.png" });
  await page.setViewportSize({ width: 1366, height: 768 });
  await plannerActivity.getByRole("button", { name: "View activity" }).click();
  await panel.screenshot({ path: "/tmp/blog-agents-ready-panel.png" });
  await panel.getByRole("button", { name: "Open planner result" }).click();
  await expect(panel.getByText("Article outline", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Replace draft", exact: true })).toHaveCount(0);
  const reportDownload = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Download report", exact: true }).click();
  const downloadedReport = await reportDownload;
  expect(downloadedReport.suggestedFilename()).toBe("planner-result.txt");
  const reportPath = await downloadedReport.path();
  expect(reportPath).not.toBeNull();
  const reportText = await readFile(reportPath!, "utf8");
  for (const content of [
    "planner result",
    "planner completed the requested work.",
    "Article outline",
    "Start with the reader’s task.",
    "Invoice essentials",
    "Payment instructions",
  ])
    expect(reportText).toContain(content);
  await panel.getByRole("button", { name: "Copy report", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(reportText);
  await panel.screenshot({ path: "/tmp/blog-agents-report-actions-panel.png" });
  const attachmentRequestCount = () =>
    page.evaluate(
      () =>
        (window as unknown as { agentFixture: { attachmentRequests: string[] } }).agentFixture.attachmentRequests
          .length,
    );
  const requestsBeforeReportRevisit = await attachmentRequestCount();
  await panel.getByRole("tab", { name: "Chat", exact: true }).click();
  await expect(composer).toBeVisible();
  await panel.getByRole("tab", { name: "Sources", exact: true }).click();
  await expect(panel.getByText("Article outline", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Download report", exact: true })).toBeEnabled();
  expect(await attachmentRequestCount()).toBe(requestsBeforeReportRevisit);
  await panel.getByRole("button", { name: "Back to sources", exact: true }).click();
  await expect(panel.getByRole("button", { name: /planner result/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Download report", exact: true })).toHaveCount(0);
  await panel.getByRole("tab", { name: "Chat", exact: true }).click();
  await panel.getByRole("button", { name: "Use planner result" }).click();
  await expect(panel.getByRole("heading", { name: "planner result" })).toBeVisible();
  await panel.getByRole("button", { name: "Use with Writer" }).click();
  await expect(composer).toContainText("Keep this new instruction");
  expect(
    await page.evaluate(
      () => (window as unknown as { agentFixture: { requests: unknown[] } }).agentFixture.requests.length,
    ),
  ).toBe(1);
  await panel.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(panel.getByText("Working with Writer…")).toBeVisible();
  await page.evaluate(() => (window as unknown as { agentFixture: { complete: () => void } }).agentFixture.complete());
  await panel.getByRole("button", { name: "Use writer result" }).click();
  await panel.getByRole("button", { name: "Preview complete draft" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("This complete replacement");
  const body = page.getByRole("textbox", { name: "Article body", includeHidden: true });
  await expect(body).toContainText("A clear introduction");
  await page.screenshot({ path: "/tmp/blog-agents-preview-1366.png" });
  await dialog.getByRole("button", { name: "Replace draft", exact: true }).click();
  await expect(body).toContainText("This complete replacement");
  await body.fill("Newer work after approval");
  await expect(panel.getByRole("button", { name: "Undo replacement" })).toBeDisabled();
  await body.fill("This complete replacement makes the guide easier to follow.");
  await panel.getByRole("button", { name: "Undo replacement" }).click();
  await expect(body).toContainText("A clear introduction");
  await panel.getByRole("tab", { name: "Chat", exact: true }).click();
  await composer.fill("/audit");
  await composer.press("Enter");
  await panel.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(panel.getByText("Working with Auditor…")).toBeVisible();
  await page.evaluate(() => (window as unknown as { agentFixture: { complete: () => void } }).agentFixture.complete());
  await panel.getByRole("button", { name: "Use auditor result" }).click();
  await panel.getByRole("button", { name: "Use with Optimizer" }).click();
  await panel.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(panel.getByText("Working with Optimizer…")).toBeVisible();
  await page.evaluate(() => (window as unknown as { agentFixture: { complete: () => void } }).agentFixture.complete());
  await panel.getByRole("button", { name: "Open optimizer result" }).click();
  await expect(panel.getByText("invoice guide", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: "/tmp/blog-agents-report-1280.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await panel.getByRole("tab", { name: "Chat", exact: true }).click();
  await panel.getByRole("button", { name: "Use optimizer result" }).click();
  await panel.getByRole("button", { name: "Preview complete draft" }).click();
  await dialog.getByRole("button", { name: "Replace draft", exact: true }).click();
  await expect(body).toContainText("This complete replacement");
  await panel.getByRole("button", { name: "Undo replacement" }).click();
  await body.fill("A newer edit that must never be overwritten.");
  await panel.getByRole("button", { name: "Preview complete draft" }).click();
  await expect(dialog.getByRole("button", { name: "Draft changed · run again" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Keep current draft" }).click();
  await expect(panel.getByRole("button", { name: "Prepare new request", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "Prepare new request", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Remove agent" })).toBeVisible();
  await expect(panel.getByText("Content changed", { exact: true }).first()).toBeVisible();
  await panel.getByRole("button", { name: "Open optimizer result" }).click();
  await panel.getByRole("button", { name: "Show message" }).click();
  await expect(panel.locator('[data-agent-run="run-4"]')).toBeFocused();
  await panel.getByRole("tab", { name: "Sources", exact: true }).click();
  await panel.getByRole("button", { name: "Back to sources", exact: true }).click();
  for (const agent of ["planner", "writer", "auditor", "optimizer"])
    await expect(panel.getByRole("button", { name: new RegExp(`${agent} result`) })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Open Invoicing reference" })).toBeVisible();
  await panel.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(panel.getByRole("link", { name: "Open Earlier reference" })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Open Invoicing reference" })).toHaveCount(1);
  await expect(panel.getByRole("button", { name: "Load more", exact: true })).toHaveCount(0);
  const requestsBeforeListRevisit = await attachmentRequestCount();
  for (let visit = 0; visit < 2; visit++) {
    await panel.getByRole("tab", { name: "Chat", exact: true }).click();
    await expect(composer).toBeVisible();
    await panel.getByRole("tab", { name: "Sources", exact: true }).click();
    await expect(panel.getByRole("link", { name: "Open Earlier reference" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Open Invoicing reference" })).toHaveCount(1);
    await expect(panel.getByRole("button", { name: "Load more", exact: true })).toHaveCount(0);
    expect(await attachmentRequestCount()).toBe(requestsBeforeListRevisit);
  }
  await page.screenshot({ path: "/tmp/blog-agents-sources-1280.png" });
  await panel.screenshot({ path: "/tmp/blog-agents-sources-panel.png" });
  await page.reload();
  await expect(panel.getByRole("button", { name: "Open optimizer result" })).toBeVisible();
  await composer.fill("/plan");
  await composer.press("Enter");
  await composer.pressSequentially("Plan a second guide");
  await panel.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(panel.getByText("Working with Planner…")).toBeVisible();
  await page.evaluate(() => (window as unknown as { agentFixture: { fail: () => void } }).agentFixture.fail());
  await expect(panel.getByText("Planner couldn’t finish")).toBeVisible();
  await panel.screenshot({ path: "/tmp/blog-agent-failed-retry-icon.png" });
  await composer.fill("Keep this recovery instruction");
  await panel.getByRole("button", { name: "Retry Planner", exact: true }).click();
  await expect(composer).toContainText("Keep this recovery instruction");
  const countBeforeRetry = await page.evaluate(
    () => (window as unknown as { agentFixture: { requests: unknown[] } }).agentFixture.requests.length,
  );
  await panel.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(panel.getByText("Working with Planner…")).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { agentFixture: { requests: unknown[] } }).agentFixture.requests.length,
    ),
  ).toBe(countBeforeRetry + 1);
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(panel.getByText("Stopped", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/blog-agents-recovery-1280.png" });
  await composer.fill("/plan");
  await composer.press("Enter");
  await composer.pressSequentially("Plan after a stopped request");
  await panel.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(panel.getByText("Working with Planner…")).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { agentFixture: { interrupt: () => void } }).agentFixture.interrupt(),
  );
  await expect(panel.getByText("Connection interrupted", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Check status", exact: true })).toBeEnabled();
  await page.screenshot({ path: "/tmp/blog-agents-interrupted-1280.png" });
  await page.evaluate(() => {
    sessionStorage.setItem(
      'assistant:["owner","blog","post"]:selection:thread-1',
      JSON.stringify({ agentId: "future-agent", attachmentIds: ["missing-input"] }),
    );
    const value = JSON.parse(sessionStorage.getItem("mock-agent-data")!);
    value.executions.push({
      id: "expired-run",
      operation: "agent",
      executionMode: "standalone",
      status: "completed",
      label: "Expired result",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      expiresAt: "2020-01-01T00:00:00Z",
      artifact: null,
    });
    sessionStorage.setItem("mock-agent-data", JSON.stringify(value));
  });
  await page.reload();
  await expect(panel.getByText("Unavailable agent", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Remove agent", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Remove unavailable attachment from message" }).click();
  await panel.getByRole("button", { name: "Prepare new request", exact: true }).click();
  await expect(panel.getByRole("listbox", { name: "Agents" })).toBeVisible();
  await page.screenshot({ path: "/tmp/blog-agents-commands-1280.png" });
  await page.evaluate(() => {
    const value = JSON.parse(sessionStorage.getItem("mock-agent-data")!);
    value.attachments = [];
    sessionStorage.setItem("mock-agent-data", JSON.stringify(value));
  });
  await page.reload();
  await panel.getByRole("tab", { name: "Sources", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "No sources yet", exact: true })).toBeVisible();
  await panel.screenshot({ path: "/tmp/blog-agents-sources-empty-panel.png" });
  expect(errors).toEqual([]);
});
