import { build } from "esbuild";
import { test, expect } from "@playwright/test";
import type { AssistantProposal } from "../../lib/assistant/types.ts";
import type { BlogProposalData } from "../../lib/blog/assistantTypes.ts";
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
    function App(){const editor=useEditor({extensions:[StarterKit],content:document.body,editorProps:{attributes:{role:'textbox','aria-label':'Article body'}}});return <main className="platform-shell" style={{height:'100vh'}}><BlogEditorShell title={document.title} initialAssistantOpen status="Draft" saveState="saved" canEdit toolbar={null} settings={null} onSave={()=>{}} onPreview={()=>{}} onReview={()=>{}} assistant={(onClose)=><BlogAssistantPanel postId="post" ownerId="owner" editor={editor} document={document} onMetadata={()=>{}} onReplaceDocument={()=>{}} onClose={onClose}/>}><h2 className="text-heading-1">{document.title}</h2><EditorContent editor={editor}/></BlogEditorShell><Toaster/></main>};createRoot(window.document.getElementById('root')).render(<App/>);
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
});

async function streamingChatHarness(page: import("@playwright/test").Page, emptyHistory = false) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript((emptyHistory) => {
    const now = new Date().toISOString();
    const config = {
      enabled: true,
      provider: "fixture",
      capabilities: { images: true, structuredOutput: true, webSearch: false, urlRetrieval: false },
    };
    const firstThread = {
      id: "thread-1",
      resourceId: "post",
      integrationKey: "blog",
      title: "First conversation",
      type: "chat",
      settings: {},
      composerDraft: "",
      createdAt: now,
      updatedAt: now,
    };
    const threads = emptyHistory ? [] : [firstThread];
    const runs: Record<string, unknown>[] = [],
      messages: Record<string, unknown>[] = [],
      attachments: Record<string, unknown>[] = [];
    const fixture = {
      starts: 0,
      requests: [] as Record<string, unknown>[],
      aborts: 0,
      abortedRunIds: [] as string[],
      threads: threads.length,
      creates: 0,
      attachmentPosts: 0,
      nextThreadId: "",
      historyReads: [] as string[],
      holdHistoryReads: false,
      emitInitialText: true,
      rejectNextRun: "",
      rejectNextRunStatus: 400,
      rejectRunResponse: "",
      titles: [] as string[],
      streams: {} as Record<string, { delta: (text: string) => void; complete: (withProposal?: boolean) => void }>,
      holdNextRun: false,
      releaseResponses: {} as Record<string, () => void>,
      activeRuns: () => runs.filter((run) => run.status === "running").map((run) => run.id),
    };
    Object.assign(window, { fixture, process: { env: { NODE_ENV: "production" } } });
    window.fetch = async (input, options) => {
      const url = String(input),
        method = options?.method ?? "GET";
      const body = typeof options?.body === "string" ? JSON.parse(options.body) : {};
      if (url === "/api/assistant/blog/config") return Response.json(config);
      if (new URL(url, location.href).pathname.endsWith("/threads")) {
        if (method === "POST") {
          fixture.creates++;
          const thread = { ...firstThread, id: `thread-${threads.length + 1}`, title: body.title ?? "New thread" };
          threads.push(thread);
          fixture.titles.push(thread.title);
          fixture.threads = threads.length;
          return Response.json({ thread });
        }
        return Response.json({ threads });
      }
      if (/\/threads\/[^/]+\/attachments$/.test(url) && method === "POST") {
        fixture.attachmentPosts++;
        const file = options?.body instanceof FormData ? (options.body.get("file") as File) : null;
        const attachment = {
          id: `attachment-${attachments.length + 1}`,
          threadId: url.split("/").at(-2),
          messageId: null,
          type: file ? "file" : "link",
          label: file?.name ?? body.label ?? body.url,
          data: file ? { mimeType: file.type, sizeBytes: file.size } : { url: body.url },
          status: "ready",
          expiresAt: null,
          createdAt: now,
          updatedAt: now,
        };
        attachments.push(attachment);
        return Response.json({ attachment });
      }
      if (/\/threads\/[^/]+$/.test(url)) {
        const thread = threads.find((entry) => entry.id === url.split("/").at(-1))!;
        if (method === "PATCH") {
          Object.assign(thread, body);
          return Response.json({ thread });
        }
        fixture.historyReads.push(thread.id);
        if (fixture.holdHistoryReads) await new Promise<void>(() => {});
        return Response.json({
          ...config,
          thread,
          runs: runs.filter((run) => run.threadId === thread.id),
          messages: messages.filter((message) => message.threadId === thread.id),
          attachments: attachments.filter((attachment) => attachment.threadId === thread.id),
        });
      }
      if (url.includes("/proposals/") && method === "PATCH") return Response.json({ status: body.status });
      if (url === "/api/assistant/blog/runs") {
        const holdResponse = fixture.holdNextRun;
        fixture.holdNextRun = false;
        fixture.starts++;
        fixture.requests.push(body);
        if (fixture.rejectNextRun) {
          const error = fixture.rejectNextRun;
          fixture.rejectNextRun = "";
          return Response.json({ error }, { status: fixture.rejectNextRunStatus });
        }
        let thread = fixture.nextThreadId ? undefined : threads.find((entry) => entry.id === body.threadId);
        if (!thread) {
          thread = {
            ...firstThread,
            id: fixture.nextThreadId || `thread-${threads.length + 1}`,
            title: body.message.trim().slice(0, 80),
            settings: body.settings ?? {},
          };
          threads.push(thread);
          fixture.titles.push(thread.title);
          fixture.threads = threads.length;
        }
        fixture.nextThreadId = "";
        const referenceAttachments = (body.references ?? []).map((url: string) => {
          const attachment = {
            id: `reference-${attachments.length + 1}`,
            threadId: thread.id,
            messageId: body.inputMessageId ?? `user-${fixture.starts}`,
            type: "link",
            label: new URL(url).hostname,
            data: { url },
            status: "ready",
            expiresAt: null,
            createdAt: now,
            updatedAt: now,
          };
          attachments.push(attachment);
          return attachment;
        });
        const run = {
          id: `run-${fixture.starts}`,
          threadId: thread.id,
          resourceId: "post",
          integrationKey: "blog",
          executionMode: "conversational",
          operation: "chat",
          status: "running",
          provider: "fixture",
          model: "fixture",
          inputMessageId: body.inputMessageId ?? `user-${fixture.starts}`,
          assistantMessageId: `assistant-${fixture.starts}`,
          request: {
            ...body,
            attachmentIds: [
              ...(body.attachmentIds ?? []),
              ...referenceAttachments.map((file: { id: string }) => file.id),
            ],
          },
          response: null,
          errorMessage: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        };
        runs.push(run);
        for (const attachment of attachments)
          if (run.request.attachmentIds.includes(attachment.id)) attachment.messageId = run.inputMessageId;
        if (!messages.some((message) => message.id === run.inputMessageId))
          messages.push({
            id: run.inputMessageId,
            threadId: run.threadId,
            runId: null,
            role: "user",
            parts: [
              { type: "text", text: body.message },
              ...run.request.attachmentIds.map((attachmentId: string) => ({ type: "attachment", attachmentId })),
            ],
            meta: {},
            createdAt: now,
            updatedAt: now,
          });
        messages.push({
          id: run.assistantMessageId,
          threadId: run.threadId,
          runId: run.id,
          role: "assistant",
          parts: [],
          meta: {},
          createdAt: now,
          updatedAt: now,
        });
        if (holdResponse) {
          await new Promise<void>((resolve, reject) => {
            const abort = () => {
              fixture.aborts++;
              fixture.abortedRunIds.push(run.id);
              run.status = "cancelled";
              reject(new DOMException("Aborted", "AbortError"));
            };
            fixture.releaseResponses[run.id] = () => {
              options?.signal?.removeEventListener("abort", abort);
              resolve();
            };
            options?.signal?.addEventListener("abort", abort, { once: true });
          });
        }
        if (fixture.rejectRunResponse) {
          const error = fixture.rejectRunResponse;
          fixture.rejectRunResponse = "";
          runs.splice(runs.indexOf(run), 1);
          for (let index = messages.length - 1; index >= 0; index--)
            if (
              messages[index].id === run.assistantMessageId ||
              (!body.inputMessageId && messages[index].id === run.inputMessageId)
            )
              messages.splice(index, 1);
          return Response.json({ error }, { status: 400 });
        }
        return new Response(
          new ReadableStream({
            start(controller) {
              const emit = (event: unknown) =>
                controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n"));
              emit({ type: "run", run, attachments: referenceAttachments });
              if (fixture.emitInitialText)
                emit({
                  type: "text-delta",
                  text: "**Start with a clear outline**, then explain each step using a practical example.\n\n- First step\n- Second step\n\n[Reference](https://example.com)\n\n```js\nconst amount = 42;\n```\n\n| Item | Value |\n| --- | --- |\n| Total | 42 |",
                });
              const complete = (withProposal = false) => {
                run.status = "completed";
                const response = {
                  text: "**Use the attached example** to make each invoicing step concrete.",
                  citations: [],
                  proposals: withProposal
                    ? [
                        {
                          id: "edit-1",
                          status: "pending",
                          data: {
                            type: "edit",
                            originalText: "A clear introduction helps readers understand the article.",
                            replacement: [
                              {
                                type: "paragraph",
                                content: [
                                  {
                                    type: "text",
                                    text: "Start with a concrete invoicing example that readers can follow.",
                                  },
                                ],
                              },
                            ],
                          },
                        },
                      ]
                    : [],
                  data: { keywords: [], searchStatus: "not_requested" },
                };
                Object.assign(run, { response, completedAt: now });
                const message = messages.find((entry) => entry.id === run.assistantMessageId)!;
                message.parts = [
                  { type: "text", text: response.text },
                  ...response.proposals.map((proposal) => ({ type: "proposal", proposal })),
                ];
                emit({ type: "completed", run });
                controller.close();
              };
              fixture.streams[run.id] = {
                delta: (text) => emit({ type: "text-delta", text }),
                complete,
              };
              options?.signal?.addEventListener(
                "abort",
                () => {
                  if (run.status !== "running") return;
                  fixture.aborts++;
                  fixture.abortedRunIds.push(run.id);
                  run.status = "cancelled";
                  controller.error(new DOMException("Aborted", "AbortError"));
                },
                { once: true },
              );
            },
          }),
          { headers: { "Content-Type": "application/x-ndjson" } },
        );
      }
      throw new Error(`Unexpected fixture request: ${method} ${url}`);
    };
  }, emptyHistory);
  await page.route("https://chat-stream-harness.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.goto("https://chat-stream-harness.test/");
  const assistant = page.getByRole("complementary", { name: "Assistant" });
  const composer = assistant.getByRole("combobox", { name: "Message to assistant" });
  await expect(composer).toBeEnabled();
  return { assistant, composer, errors };
}

test("assistant settings replace the chat view, preserve drafts, and share current-content state with the composer", async ({
  page,
}) => {
  const { assistant, composer, errors } = await streamingChatHarness(page);
  const draft = "Keep this unfinished question";
  const settings = assistant.getByRole("button", { name: "Assistant settings", exact: true });
  const historyButton = assistant.getByRole("button", { name: "History", exact: true });
  const history = assistant.getByRole("region", { name: "Conversation history", exact: true });
  const include = assistant.getByRole("switch", { name: "Include current content", exact: true });
  const tone = assistant.getByLabel("Tone", { exact: true });
  const back = assistant.getByRole("button", { name: "Back to chat", exact: true });
  const currentContent = assistant.getByRole("button", { name: "Remove current context", exact: true });
  await composer.fill(draft);
  await expect(currentContent).toBeVisible();
  await settings.click();
  await expect(back).toBeVisible();
  await expect(composer).toBeHidden();
  await expect(include).toBeChecked();
  await expect(assistant.getByRole("switch", { name: "Web search", exact: true })).toBeVisible();
  await expect(tone).toBeVisible();
  await expect(assistant.getByRole("button", { name: "Clear history", exact: true })).toHaveCount(0);
  await expect(assistant.getByRole("button", { name: "Delete thread", exact: true })).toHaveCount(0);
  await expect(assistant.getByText(/sent to fixture/)).toHaveCount(0);
  for (const [width, height] of [
    [1366, 768],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(settings).toBeInViewport();
    await expect(back).toBeInViewport();
    await expect(include).toBeInViewport();
    await expect(tone).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `/tmp/assistant-settings-panel-${width}.png`, animations: "disabled" });
  }
  await historyButton.click();
  await expect(history).toBeVisible();
  await expect(tone).toBeHidden();
  await expect(composer).toBeHidden();
  await settings.click();
  await expect(history).toBeHidden();
  await expect(tone).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tone).toBeHidden();
  await expect(composer).toBeVisible();
  await expect(composer).toHaveText(draft);
  await settings.click();
  await include.click();
  await expect(include).not.toBeChecked();
  await back.click();
  await expect(composer).toHaveText(draft);
  await expect(currentContent).toHaveCount(0);
  await settings.click();
  await expect(include).not.toBeChecked();
  await include.click();
  await expect(include).toBeChecked();
  await back.click();
  await expect(currentContent).toBeVisible();
  await currentContent.click();
  await settings.click();
  await expect(include).not.toBeChecked();
  await back.click();
  await expect(composer).toHaveText(draft);
  expect(errors).toEqual([]);
});

test("chat renders pending, streamed, and completed responses without reading thread history", async ({ page }) => {
  const { assistant, composer, errors } = await streamingChatHarness(page, true);
  await page.evaluate(`Object.assign(window.fixture, {
    holdNextRun: true, holdHistoryReads: true, emitInitialText: false
  })`);
  const query = "Make this introduction clearer";
  await composer.fill(query);
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => page.evaluate("window.fixture.starts")).toBe(1);
  expect(await page.evaluate("window.fixture.creates")).toBe(0);
  await expect(assistant.getByText(query, { exact: true })).toBeVisible();
  await expect(composer).toHaveText("");
  await expect(assistant.getByText("Generating response…", { exact: true })).toBeVisible();
  expect(await page.evaluate("window.fixture.requests[0].threadId")).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  for (const [width, height] of [
    [1366, 768],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(composer).toBeInViewport();
    await expect(assistant.getByText(query, { exact: true })).toBeInViewport();
    await expect(assistant.getByText("Generating response…", { exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `/tmp/blog-optimistic-chat-${width}.png` });
  }
  await expect.poll(() => page.evaluate("window.fixture.starts")).toBe(1);
  expect(await page.evaluate("window.fixture.historyReads")).toEqual([]);
  await expect(assistant.getByText(query, { exact: true })).toHaveCount(1);
  await expect(composer).toHaveText("");
  await expect(assistant.getByText("Generating response…", { exact: true })).toBeVisible();
  await page.evaluate('window.fixture.releaseResponses["run-1"]()');
  await expect.poll(() => page.evaluate('!!window.fixture.streams["run-1"]')).toBe(true);
  expect(await page.evaluate("window.fixture.historyReads")).toEqual([]);
  await expect(assistant.getByText(query, { exact: true })).toHaveCount(1);
  await expect(assistant.getByText("Generating response…", { exact: true })).toBeVisible();
  await page.evaluate('window.fixture.streams["run-1"].delta("Start with a concrete example.")');
  await expect(assistant.getByText("Start with a concrete example.", { exact: true })).toBeVisible();
  await expect(assistant.getByText(query, { exact: true })).toHaveCount(1);
  await page.evaluate('window.fixture.streams["run-1"].complete(true)');
  await expect(assistant.getByText("Use the attached example", { exact: true })).toBeVisible();
  await expect(assistant.getByRole("button", { name: "Apply edit", exact: true })).toBeEnabled();
  await expect(
    assistant.getByText("Start with a concrete invoicing example that readers can follow.", { exact: true }),
  ).toBeVisible();
  await expect(assistant.getByText(query, { exact: true })).toHaveCount(1);
  await expect(composer).toHaveText("");
  await expect(assistant.getByText("Generating response…", { exact: true })).toHaveCount(0);
  await expect(assistant.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  expect(await page.evaluate("window.fixture.historyReads")).toEqual([]);
  await composer.fill("Next question in this conversation");
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => page.evaluate("window.fixture.starts")).toBe(2);
  expect(await page.evaluate("window.fixture.requests[1].threadId")).toBe("thread-1");
  expect(await page.evaluate("window.fixture.creates")).toBe(0);
  expect(await page.evaluate("window.fixture.historyReads")).toEqual([]);
  await page.evaluate('window.fixture.streams["run-2"].complete()');
  expect(errors).toEqual([]);
});

test("reference links go directly in a first run and survive rejection until acknowledgement", async ({ page }) => {
  const { assistant, composer, errors } = await streamingChatHarness(page, true);
  const url = "https://example.com/invoicing";
  await assistant.getByRole("button", { name: "Attach files or links", exact: true }).click();
  await page.getByRole("button", { name: "Add link", exact: true }).click();
  await page.getByRole("textbox", { name: "URL", exact: true }).fill(url);
  await page.getByRole("button", { name: "Add link", exact: true }).click();
  const remove = assistant.getByRole("button", { name: `Remove reference ${url}`, exact: true });
  await expect(remove).toBeVisible();
  await page.evaluate(
    'Object.assign(window.fixture, {rejectNextRun: "Temporary connection error", rejectNextRunStatus: 503})',
  );
  await composer.fill("Use this reference");
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => page.evaluate("window.fixture.starts")).toBe(1);
  await expect(composer).toHaveText("Use this reference");
  await expect(remove).toBeVisible();
  const first = await page.evaluate<Record<string, unknown>>("window.fixture.requests[0]");
  expect(first).toMatchObject({ references: [url], resourceId: "post" });
  expect(await page.evaluate("window.fixture.creates")).toBe(0);
  expect(await page.evaluate("window.fixture.attachmentPosts")).toBe(0);
  expect(await page.evaluate("window.fixture.historyReads")).toEqual([]);
  await page.evaluate("window.fixture.holdNextRun = true");
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => page.evaluate("window.fixture.starts")).toBe(2);
  expect(await page.evaluate("window.fixture.requests[1]")).toMatchObject({
    threadId: first.threadId,
    clientRequestId: first.clientRequestId,
    references: [url],
  });
  await expect(remove).toBeVisible();
  await composer.fill("Newer draft");
  await page.evaluate('window.fixture.releaseResponses["run-2"]()');
  await expect(remove).toHaveCount(0);
  await expect(composer).toHaveText("Newer draft");
  await expect(assistant.getByText("Use this reference", { exact: true })).toHaveCount(1);
  await expect(assistant.getByRole("link", { name: /example\.com/ })).toBeVisible();
  await expect(assistant.getByText("Attachment unavailable", { exact: true })).toHaveCount(0);
  await page.evaluate('window.fixture.streams["run-2"].complete()');
  await expect(assistant.getByText("Use the attached example", { exact: true })).toBeVisible();
  expect(await page.evaluate("window.fixture.creates")).toBe(0);
  expect(await page.evaluate("window.fixture.attachmentPosts")).toBe(0);
  expect(await page.evaluate("window.fixture.historyReads")).toEqual([]);
  expect(errors).toEqual([]);
});

test("a replacement canonical thread does not inherit the previous conversation and keeps its newer draft", async ({
  page,
}) => {
  const { assistant, composer, errors } = await streamingChatHarness(page);
  await composer.fill("Old private question");
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => page.evaluate('!!window.fixture.streams["run-1"]')).toBe(true);
  await page.evaluate('window.fixture.streams["run-1"].complete()');
  await expect(assistant.getByText("Use the attached example", { exact: true })).toBeVisible();
  await page.evaluate(
    'Object.assign(window.fixture, {nextThreadId: "replacement", holdNextRun: true, emitInitialText: false})',
  );
  await composer.fill("New conversation question");
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => page.evaluate("window.fixture.starts")).toBe(2);
  await expect(assistant.getByText("New conversation question", { exact: true })).toBeVisible();
  await composer.fill("Follow-up draft");
  await page.evaluate('window.fixture.releaseResponses["run-2"]()');
  await expect(assistant.getByText("Old private question", { exact: true })).toHaveCount(0);
  await expect(assistant.getByText("Use the attached example", { exact: true })).toHaveCount(0);
  await expect(assistant.getByText("New conversation question", { exact: true })).toHaveCount(1);
  await expect(composer).toHaveText("Follow-up draft");
  await page.evaluate('window.fixture.streams["run-2"].delta("New answer in the replacement conversation.")');
  await expect(assistant.getByText("New answer in the replacement conversation.", { exact: true })).toBeVisible();
  await page.evaluate('window.fixture.streams["run-2"].complete()');
  await expect(assistant.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => page.evaluate("window.fixture.starts")).toBe(3);
  expect(await page.evaluate("window.fixture.requests[2].threadId")).toBe("replacement");
  expect(await page.evaluate("window.fixture.creates")).toBe(0);
  expect(await page.evaluate("window.fixture.historyReads")).toEqual(["thread-1"]);
  await page.evaluate('window.fixture.streams["run-3"].complete()');
  expect(errors).toEqual([]);
});

for (const emptyHistory of [false, true])
  test(`attachments stay with the sent message in ${emptyHistory ? "a new" : "an existing"} thread without history reads`, async ({
    page,
  }) => {
    const { assistant, composer, errors } = await streamingChatHarness(page, emptyHistory);
    const initialHistoryReads = emptyHistory ? [] : ["thread-1"];
    expect(await page.evaluate("window.fixture.historyReads")).toEqual(initialHistoryReads);
    await assistant.locator('input[type="file"]').setInputFiles({
      name: "invoice.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3bkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(assistant.getByRole("button", { name: "Remove invoice.png from message", exact: true })).toBeVisible();
    await page.evaluate("window.fixture.holdNextRun = true; window.fixture.holdHistoryReads = true");
    await composer.fill("Explain the attached invoice");
    await assistant.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => page.evaluate("window.fixture.starts")).toBe(1);
    await expect(composer).toHaveText("");
    await expect(assistant.getByRole("button", { name: "Remove invoice.png from message", exact: true })).toHaveCount(
      0,
    );
    await expect(assistant.getByText("invoice.png", { exact: true })).toBeVisible();
    await expect(assistant.getByText("Image · Sent with your message", { exact: true })).toBeVisible();
    await page.evaluate('window.fixture.releaseResponses["run-1"]()');
    await expect(assistant.getByText("Start with a clear outline", { exact: false })).toBeVisible();
    expect(await page.evaluate("window.fixture.historyReads")).toEqual(initialHistoryReads);
    await page.evaluate('window.fixture.streams["run-1"].complete()');
    await expect(assistant.getByText("Use the attached example", { exact: true })).toBeVisible();
    await expect(assistant.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
    await expect(assistant.getByText("invoice.png", { exact: true })).toHaveCount(1);
    await expect(assistant.getByText("Attachment unavailable", { exact: true })).toHaveCount(0);
    expect(await page.evaluate("window.fixture.historyReads")).toEqual(initialHistoryReads);
    expect(errors).toEqual([]);
  });

test("completed responses can be copied and retried without replacing a newer draft or duplicating the query", async ({
  page,
}) => {
  const { assistant, composer, errors } = await streamingChatHarness(page);
  const query = "Explain the payment steps";
  const responseMarkdown = "**Use the attached example** to make each invoicing step concrete.";
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await composer.fill(query);
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(assistant.getByText("Start with a clear outline", { exact: false })).toBeVisible();
  await expect(assistant.getByRole("button", { name: "Copy response", exact: true })).toHaveCount(0);
  await expect(assistant.getByRole("button", { name: "Retry response", exact: true })).toHaveCount(0);
  await page.evaluate('window.fixture.streams["run-1"].complete()');
  const copy = assistant.getByRole("button", { name: "Copy response", exact: true });
  const retry = assistant.getByRole("button", { name: "Retry response", exact: true });
  await expect(copy).toBeVisible();
  await expect(retry).toBeEnabled();
  await copy.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(responseMarkdown);
  for (const close of await page.getByRole("button", { name: "Close toast", exact: true }).all()) await close.click();
  for (const [width, height] of [
    [1366, 768],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(copy).toBeInViewport();
    await expect(retry).toBeInViewport();
    await expect(composer).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `/tmp/assistant-response-actions-${width}.png` });
  }
  await composer.fill("/");
  await assistant.getByRole("option", { name: /Writer/ }).click();
  await composer.press("End");
  await composer.pressSequentially("Draft a follow-up about late payments");
  const newerDraft = await composer.textContent();
  await expect(composer.getByText("Writer", { exact: true })).toBeVisible();
  await page.evaluate("window.fixture.holdNextRun = true; window.fixture.holdHistoryReads = true");
  await retry.focus();
  await expect(retry).toBeFocused();
  await retry.press("Enter");
  await expect.poll(() => page.evaluate("window.fixture.starts")).toBe(2);
  expect(await page.evaluate("window.fixture.requests[1]")).toMatchObject({
    operation: "chat",
    message: query,
    inputMessageId: "user-1",
    threadId: "thread-1",
  });
  expect(await page.evaluate("window.fixture.requests[1].agentId")).toBeUndefined();
  await expect(assistant.getByText(query, { exact: true })).toHaveCount(1);
  await expect(composer).toHaveText(newerDraft!);
  await expect(retry).toBeDisabled();
  await page.evaluate('window.fixture.releaseResponses["run-2"]()');
  await expect(assistant.getByText("Start with a clear outline", { exact: false })).toBeVisible();
  await page.evaluate('window.fixture.streams["run-2"].complete()');
  await expect(assistant.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await expect(copy).toHaveCount(2);
  await expect(retry).toHaveCount(2);
  await expect(retry.last()).toBeEnabled();
  await expect(assistant.getByText(query, { exact: true })).toHaveCount(1);
  await expect(assistant.getByRole("article").first()).toHaveText(query);
  await expect(composer).toHaveText(newerDraft!);
  await expect(composer.getByText("Writer", { exact: true })).toBeVisible();
  expect(await page.evaluate("window.fixture.historyReads")).toEqual(["thread-1"]);
  for (const close of await page.getByRole("button", { name: "Close toast", exact: true }).all()) await close.click();
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new Error("Clipboard blocked for this test")),
    });
  });
  await copy.last().click();
  await expect(
    page.locator('[data-slot="toast-title"]').filter({
      hasText: "Could not copy. Select the response text and copy it manually.",
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("a rejected optimistic send restores the query for retry without a duplicate message", async ({ page }) => {
  const { assistant, composer, errors } = await streamingChatHarness(page);
  const query = "Explain the payment steps";
  await page.evaluate('window.fixture.rejectNextRun = "The request could not be accepted. Try again."');
  await composer.fill(query);
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(composer).toHaveText(query);
  await expect(assistant.getByText("Generating response…", { exact: true })).toHaveCount(0);
  await expect(assistant.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(assistant.getByText("Start with a clear outline", { exact: false })).toBeVisible();
  await expect(composer).toHaveText("");
  await expect(assistant.getByText(query, { exact: true })).toHaveCount(1);
  await page.evaluate('window.fixture.streams["run-2"].complete()');
  await expect(assistant.getByText(query, { exact: true })).toHaveCount(1);
  expect(await page.evaluate("window.fixture.starts")).toBe(2);
  expect(errors).toEqual([]);
});

test("a delayed rejected send keeps the original query recoverable and preserves a newer draft", async ({ page }) => {
  const { assistant, composer, errors } = await streamingChatHarness(page);
  const query = "Explain the payment steps";
  const followup = "Then explain late payments";
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate("window.fixture.holdNextRun = true");
  await composer.fill(query);
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => page.evaluate("window.fixture.starts")).toBe(1);
  await expect(composer).toHaveText("");
  await expect(assistant.getByText(query, { exact: true })).toBeVisible();
  await composer.fill(followup);
  await page.evaluate(`window.fixture.rejectRunResponse = "The request could not be accepted. Try again.";
    window.fixture.releaseResponses["run-1"]()`);
  await expect(assistant.getByText("Generating response…", { exact: true })).toHaveCount(0);
  await expect(assistant.getByText(query, { exact: true })).toBeVisible();
  await expect(composer).toHaveText(followup);
  await assistant.getByRole("button", { name: "Copy request", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(query);
  await expect(composer).toHaveText(followup);
  await expect(assistant.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("stopping before acknowledgement restores the query and exits the generating state", async ({ page }) => {
  const { assistant, composer, errors } = await streamingChatHarness(page);
  const query = "Explain invoice numbering";
  await page.evaluate("window.fixture.holdNextRun = true");
  await composer.fill(query);
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => page.evaluate("window.fixture.starts")).toBe(1);
  await expect(composer).toHaveText("");
  await expect(assistant.getByText(query, { exact: true })).toBeVisible();
  await assistant.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => page.evaluate("window.fixture.abortedRunIds")).toEqual(["run-1"]);
  await expect(composer).toHaveText(query);
  await expect(assistant.getByText("Generating response…", { exact: true })).toHaveCount(0);
  await expect(assistant.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("a follow-up identical to the sent query stays in the composer when the previous reply finishes", async ({
  page,
}) => {
  const { assistant, composer, errors } = await streamingChatHarness(page);
  const query = "Show another example";
  await page.evaluate("window.fixture.holdNextRun = true");
  await composer.fill(query);
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => page.evaluate("window.fixture.starts")).toBe(1);
  await expect(composer).toHaveText("");
  await composer.fill(query);
  await page.evaluate('window.fixture.releaseResponses["run-1"]()');
  await expect(assistant.getByText("Start with a clear outline", { exact: false })).toBeVisible();
  await page.evaluate('window.fixture.streams["run-1"].complete()');
  await expect(assistant.getByText("Use the attached example", { exact: true })).toBeVisible();
  await expect(assistant.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await expect(composer).toHaveText(query);
  expect(errors).toEqual([]);
});

test("chat streams concurrently across threads, stops only the selected run, and aborts when leaving the page", async ({
  page,
}) => {
  const { assistant, composer, errors } = await streamingChatHarness(page);
  await composer.fill("Help improve this introduction");
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(assistant.locator("strong").getByText("Start with a clear outline", { exact: true })).toBeVisible();
  await expect(assistant.getByRole("listitem").filter({ hasText: "First step" })).toBeVisible();
  await expect(assistant.getByRole("link", { name: "Reference", exact: true })).toHaveAttribute("target", "_blank");
  await expect(assistant.locator("pre code")).toHaveText("const amount = 42;");
  await expect(assistant.getByRole("columnheader", { name: "Value", exact: true })).toBeVisible();
  await composer.press("Enter");
  expect(await page.evaluate("window.fixture.starts")).toBe(1);
  await assistant.getByRole("button", { name: "Close assistant", exact: true }).click();
  await expect(assistant).toBeHidden();
  expect(await page.evaluate("window.fixture.aborts")).toBe(0);
  await page.getByRole("button", { name: "Assistant", exact: true }).filter({ visible: true }).click();
  await expect(assistant.getByText("Start with a clear outline", { exact: false })).toBeVisible();
  await assistant.getByRole("button", { name: "New thread", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await page.evaluate("window.fixture.aborts")).toBe(0);
  await expect(assistant.getByRole("heading", { name: "Make your next draft better.", exact: true })).toBeVisible();
  await expect(composer).toBeFocused();
  await page.evaluate('window.fixture.streams["run-1"].delta("\\n\\nFirst thread kept streaming in the background.")');
  await composer.fill("My first question");
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => page.evaluate("window.fixture.threads")).toBe(2);
  expect(await page.evaluate("window.fixture.titles")).toEqual(["My first question"]);
  await expect.poll(() => page.evaluate("window.fixture.starts")).toBe(2);
  expect(await page.evaluate("window.fixture.activeRuns()")).toEqual(["run-1", "run-2"]);
  await page.evaluate('window.fixture.streams["run-2"].delta("\\n\\nSecond thread is also streaming.")');
  await expect(assistant.getByText("Second thread is also streaming.", { exact: true })).toBeVisible();

  async function chooseThread(title: string) {
    await assistant.getByRole("button", { name: "History", exact: true }).click();
    await page
      .getByRole("region", { name: "Conversation history" })
      .getByRole("button", { name: new RegExp(title) })
      .click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  }
  await assistant.getByRole("button", { name: "History", exact: true }).click();
  const history = page.getByRole("region", { name: "Conversation history" });
  await expect(history.getByText("2 responding", { exact: true })).toBeVisible();
  await expect(history.getByText("Responding", { exact: true })).toHaveCount(2);
  await history.getByRole("button", { name: /First conversation/ }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(assistant.getByText("First thread kept streaming in the background.", { exact: true })).toBeVisible();
  await expect(assistant.getByText("Second thread is also streaming.", { exact: true })).toHaveCount(0);
  expect(await page.evaluate("window.fixture.aborts")).toBe(0);
  await page.evaluate('window.fixture.streams["run-1"].delta("\\n\\nFirst thread continues after switching back.")');
  await expect(assistant.getByText("First thread continues after switching back.", { exact: true })).toBeVisible();

  await assistant.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => page.evaluate("window.fixture.abortedRunIds")).toEqual(["run-1"]);
  expect(await page.evaluate("window.fixture.activeRuns()")).toEqual(["run-2"]);
  await page.evaluate(
    'window.fixture.streams["run-2"].delta("\\n\\nSecond thread continues after the first is stopped.")',
  );
  await chooseThread("My first question");
  await expect(
    assistant.getByText("Second thread continues after the first is stopped.", { exact: true }),
  ).toBeVisible();
  await expect(assistant.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  expect(await page.evaluate("window.fixture.abortedRunIds")).toEqual(["run-1"]);
  for (const [width, height] of [
    [1366, 768],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(composer).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `/tmp/blog-concurrent-thread-streaming-${width}.png` });
  }
  await chooseThread("First conversation");
  await page.evaluate('window.fixture.streams["run-2"].complete()');
  await expect(assistant.locator("strong").getByText("Use the attached example", { exact: true })).toHaveCount(0);
  await chooseThread("My first question");
  await expect(assistant.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await expect(assistant.locator("strong").getByText("Use the attached example", { exact: true })).toBeVisible();

  await page.evaluate("window.fixture.holdNextRun = true");
  await composer.fill("Another request");
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => page.evaluate("window.fixture.starts")).toBe(3);
  expect(await page.evaluate('!!window.fixture.releaseResponses["run-3"]')).toBe(true);
  await expect(composer).toHaveText("");
  await expect(assistant.getByText("Another request", { exact: true })).toBeVisible();
  await expect(assistant.getByText("Generating response…", { exact: true })).toBeVisible();
  await assistant.getByRole("button", { name: "New thread", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await page.evaluate("window.fixture.abortedRunIds")).toEqual(["run-1"]);
  await expect(assistant.getByText("Another request", { exact: true })).toHaveCount(0);
  await expect(assistant.getByText("Generating response…", { exact: true })).toHaveCount(0);
  await composer.fill("A parallel request");
  await assistant.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => page.evaluate("window.fixture.starts")).toBe(4);
  expect(await page.evaluate("window.fixture.activeRuns()")).toEqual(["run-3", "run-4"]);
  await page.evaluate('window.fixture.releaseResponses["run-3"]()');
  await expect.poll(() => page.evaluate('!!window.fixture.streams["run-3"]')).toBe(true);
  await page.evaluate('window.fixture.streams["run-3"].delta("\\n\\nThe delayed response stayed in its own thread.")');
  await chooseThread("My first question");
  await expect(assistant.getByText("The delayed response stayed in its own thread.", { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect.poll(() => page.evaluate("window.fixture.abortedRunIds")).toEqual(["run-1", "run-3", "run-4"]);
  expect(await page.evaluate("window.fixture.activeRuns()")).toEqual([]);
  expect(errors).toEqual([]);
});

type SectionProposalFixture = AssistantProposal & { title: string; status: "pending"; data: BlogProposalData };

const introductionText = "A clear introduction helps readers understand the article.";
const revisedIntroduction = "Start with a concrete invoicing example that readers can follow.";
const resourcesText = "Keep your payment records together.";
const obsoleteText = "Print every invoice in triplicate.";
const sectionProposals: SectionProposalFixture[] = [
  {
    id: "insert-section",
    status: "pending",
    title: "Add a practical payment checklist",
    data: {
      type: "edit",
      action: "insert",
      placement: "After Resources",
      originalText: `Resources\n${resourcesText}`,
      replacement: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Payment checklist" }] },
        { type: "paragraph", content: [{ type: "text", text: "Confirm the amount and payment date before sending." }] },
      ],
    },
  },
  {
    id: "replace-section",
    status: "pending",
    title: "Make the introduction more concrete",
    data: {
      type: "edit",
      action: "replace",
      placement: "Introduction",
      originalText: `Introduction\n${introductionText}`,
      replacement: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Introduction" }] },
        { type: "paragraph", content: [{ type: "text", text: revisedIntroduction }] },
      ],
    },
  },
  {
    id: "delete-section",
    status: "pending",
    title: "Remove the outdated printing section",
    data: { type: "edit", action: "delete", placement: "Paper copies", originalText: `Paper copies\n${obsoleteText}` },
  },
];

async function sectionProposalHarness(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ introductionText, resourcesText, obsoleteText }) => {
      const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
      const heading = (text: string) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
      Object.assign(window, {
        process: { env: { NODE_ENV: "production" } },
        proposalDocument: {
          type: "doc",
          content: [
            heading("Introduction"),
            paragraph(introductionText),
            heading("Resources"),
            paragraph(resourcesText),
            heading("Paper copies"),
            paragraph(obsoleteText),
            heading("Next steps"),
            paragraph("Send the invoice and keep a digital copy."),
          ],
        },
      });
    },
    { introductionText, resourcesText, obsoleteText },
  );
  const now = new Date().toISOString();
  const config = {
    enabled: true,
    provider: "fixture",
    capabilities: { images: true, structuredOutput: true, webSearch: false, urlRetrieval: false },
  };
  const threads = ["Section suggestions", "Other conversation"].map((title, index) => ({
    id: `section-thread-${index + 1}`,
    resourceId: "post",
    integrationKey: "blog",
    title,
    type: "chat",
    settings: {},
    composerDraft: "",
    createdAt: now,
    updatedAt: now,
  }));
  const runs: Record<string, unknown>[] = [];
  const messages: Record<string, unknown>[] = [];
  const state = {
    proposals: sectionProposals,
    outcomePatches: [] as string[],
    unexpectedRequests: [] as string[],
    errors,
  };
  await page.route("https://section-proposals.test/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === "/") return route.fulfill({ contentType: "text/html", body: html });
    if (path === "/api/assistant/blog/config") return route.fulfill({ json: config });
    if (path === "/api/assistant/blog/threads") return route.fulfill({ json: { threads } });
    if (path.includes("/proposals/")) {
      state.outcomePatches.push(`${method} ${path}`);
      return route.fulfill({ status: 500, json: { error: "Chat proposal outcomes must stay local." } });
    }
    const thread = threads.find((candidate) => path.endsWith(`/threads/${candidate.id}`));
    if (thread) {
      if (method === "PATCH") {
        Object.assign(thread, request.postDataJSON());
        return route.fulfill({ json: { thread } });
      }
      return route.fulfill({
        json: {
          ...config,
          thread,
          runs: runs.filter((run) => run.threadId === thread.id),
          messages: messages.filter((message) => message.threadId === thread.id),
          attachments: [],
        },
      });
    }
    if (path === "/api/assistant/blog/runs" && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      const index = runs.length + 1;
      const response = {
        text: "Here are three focused section changes to make the article more useful.",
        citations: [],
        proposals: state.proposals,
        data: { keywords: [], searchStatus: "not_requested" },
      };
      const run = {
        id: `section-run-${index}`,
        threadId: body.threadId,
        resourceId: "post",
        integrationKey: "blog",
        executionMode: "conversational",
        operation: "chat",
        status: "completed",
        provider: "fixture",
        model: "fixture",
        inputMessageId: `section-user-${index}`,
        assistantMessageId: `section-assistant-${index}`,
        request: body,
        response,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      };
      runs.push(run);
      messages.push(
        {
          id: run.inputMessageId,
          threadId: body.threadId,
          runId: null,
          role: "user",
          parts: [{ type: "text", text: body.message }],
          meta: {},
          createdAt: now,
          updatedAt: now,
        },
        {
          id: run.assistantMessageId,
          threadId: body.threadId,
          runId: run.id,
          role: "assistant",
          parts: [
            { type: "text", text: response.text },
            ...state.proposals.map((proposal) => ({ type: "proposal", proposal })),
          ],
          meta: {},
          createdAt: now,
          updatedAt: now,
        },
      );
      return route.fulfill({
        contentType: "application/x-ndjson",
        body:
          [
            { type: "run", run: { ...run, status: "running", response: null, completedAt: null } },
            { type: "completed", run },
          ]
            .map((event) => JSON.stringify(event))
            .join("\n") + "\n",
      });
    }
    state.unexpectedRequests.push(`${method} ${path}`);
    return route.fulfill({ status: 404, json: { error: "Unexpected fixture request" } });
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("https://section-proposals.test/");
  const assistant = page.getByRole("complementary", { name: "Assistant" });
  const composer = assistant.getByRole("combobox", { name: "Message to assistant" });
  await expect(composer).toBeEnabled();
  async function send(message = "Improve these sections") {
    const proposals = assistant.getByRole("region", { name: state.proposals[0].title, exact: true });
    const previousCount = await proposals.count();
    await composer.fill(message);
    await assistant.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(proposals).toHaveCount(previousCount + 1);
    await expect(proposals.last()).toBeVisible();
  }
  return {
    state,
    assistant,
    composer,
    send,
    article: page.getByRole("textbox", { name: "Article body", exact: true }),
  };
}

test("section proposals toggle inline independently and apply insert, edit, and delete to their captured sections", async ({
  page,
}) => {
  const { state, assistant, composer, send, article } = await sectionProposalHarness(page);
  await send();
  const [insert, edit, remove] = sectionProposals.map((proposal) =>
    assistant.getByRole("region", { name: proposal.title, exact: true }),
  );
  for (const card of [insert, edit, remove]) {
    await expect(card.getByRole("button", { name: "Show change", exact: true })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(card.getByRole("button", { name: "Discard proposal", exact: true })).toBeEnabled();
  }
  await expect(insert.getByText("Confirm the amount and payment date before sending.", { exact: false })).toBeHidden();
  await expect(edit.getByText(revisedIntroduction, { exact: false })).toBeHidden();
  await expect(remove.getByText(obsoleteText, { exact: false })).toBeHidden();
  for (const [width, height] of [
    [1366, 768],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(composer).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `/tmp/blog-section-proposals-collapsed-${width}.png` });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  const original = await article.textContent();
  await insert.getByRole("button", { name: "Show change", exact: true }).click();
  await expect(insert.getByText("Confirm the amount and payment date before sending.", { exact: false })).toBeVisible();
  await edit.getByRole("button", { name: "Show change", exact: true }).click();
  await expect(insert.getByRole("button", { name: "Hide", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(edit.getByText(revisedIntroduction, { exact: false })).toBeVisible();
  await expect(edit.getByText(introductionText, { exact: false })).toBeVisible();
  expect(await article.textContent()).toBe(original);
  await edit.getByRole("button", { name: "Hide", exact: true }).click();
  await insert.getByRole("button", { name: "Hide", exact: true }).click();
  for (const card of [insert, edit, remove]) {
    await card.getByRole("button", { name: "Show change", exact: true }).click();
    for (const [width, height] of [
      [1366, 768],
      [1280, 720],
    ]) {
      await page.setViewportSize({ width, height });
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByRole("button", { name: "Hide", exact: true })).toBeInViewport({ ratio: 1 });
      await page.screenshot({
        path: `/tmp/blog-section-proposal-${await card.getAttribute("aria-label")}-${width}.png`,
      });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await card.getByRole("button", { name: "Hide", exact: true }).click();
  }
  // Move the cursor into an unrelated section: each action must still use its captured target.
  await article.getByText("Send the invoice and keep a digital copy.", { exact: true }).click();
  await insert.getByRole("button", { name: "Insert section", exact: true }).click();
  await expect(article.locator(":scope > *")).toHaveText([
    "Introduction",
    introductionText,
    "Resources",
    resourcesText,
    "Payment checklist",
    "Confirm the amount and payment date before sending.",
    "Paper copies",
    obsoleteText,
    "Next steps",
    "Send the invoice and keep a digital copy.",
  ]);
  await expect(insert.getByRole("button", { name: "Insert section", exact: true })).toHaveCount(0);
  await expect(insert.getByRole("button", { name: "Discard proposal", exact: true })).toHaveCount(0);
  await edit.getByRole("button", { name: "Apply edit", exact: true }).click();
  await expect(article).toContainText(revisedIntroduction);
  await expect(article).not.toContainText(introductionText);
  await expect(edit.getByRole("button", { name: "Apply edit", exact: true })).toHaveCount(0);
  await expect(edit.getByRole("button", { name: "Discard proposal", exact: true })).toHaveCount(0);
  await remove.getByRole("button", { name: "Delete section", exact: true }).click();
  await expect(article.locator(":scope > *")).toHaveText([
    "Introduction",
    revisedIntroduction,
    "Resources",
    resourcesText,
    "Payment checklist",
    "Confirm the amount and payment date before sending.",
    "Next steps",
    "Send the invoice and keep a digital copy.",
  ]);
  await expect(remove.getByRole("button", { name: "Delete section", exact: true })).toHaveCount(0);
  await expect(remove.getByRole("button", { name: "Discard proposal", exact: true })).toHaveCount(0);
  await remove.getByRole("button", { name: "Show change", exact: true }).click();
  await expect(remove.getByText(obsoleteText, { exact: false })).toBeVisible();
  await expect(composer).toBeVisible();
  expect(state.outcomePatches).toEqual([]);
  expect(state.unexpectedRequests).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("discard hides both actions, preserves the change preview, and never writes proposal outcomes", async ({
  page,
}) => {
  const { state, assistant, send, article } = await sectionProposalHarness(page);
  await send();
  const edit = assistant.getByRole("region", { name: sectionProposals[1].title, exact: true });
  const original = await article.textContent();
  await edit.getByRole("button", { name: "Discard proposal", exact: true }).click();
  await expect(edit.getByRole("button", { name: "Apply edit", exact: true })).toHaveCount(0);
  await expect(edit.getByRole("button", { name: "Discard proposal", exact: true })).toHaveCount(0);
  await expect(edit).toContainText(sectionProposals[1].title);
  await edit.getByRole("button", { name: "Show change", exact: true }).click();
  await expect(edit.getByText(revisedIntroduction, { exact: false })).toBeVisible();
  expect(await article.textContent()).toBe(original);
  // Dismissing one suggestion does not dismiss another suggestion in the same response.
  await expect(assistant.getByRole("button", { name: "Insert section", exact: true })).toBeEnabled();
  await expect(assistant.getByRole("button", { name: "Delete section", exact: true })).toBeEnabled();
  expect(state.outcomePatches).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("loaded conversation history and page reload keep previews but never restore proposal actions", async ({
  page,
}) => {
  const { state, assistant, send } = await sectionProposalHarness(page);
  await send();
  await expect(assistant.getByRole("button", { name: "Apply edit", exact: true })).toBeEnabled();
  async function chooseThread(name: string) {
    await assistant.getByRole("button", { name: "History", exact: true }).click();
    await assistant
      .getByRole("region", { name: "Conversation history" })
      .getByRole("button", { name: new RegExp(name) })
      .click();
  }
  await chooseThread("Other conversation");
  await chooseThread("Section suggestions");
  await expect(assistant.getByRole("button", { name: "Apply edit", exact: true })).toHaveCount(0);
  await expect(assistant.getByRole("button", { name: "Insert section", exact: true })).toHaveCount(0);
  await expect(assistant.getByRole("button", { name: "Delete section", exact: true })).toHaveCount(0);
  await expect(assistant.getByRole("button", { name: "Discard proposal", exact: true })).toHaveCount(0);
  const edit = assistant.getByRole("region", { name: sectionProposals[1].title, exact: true });
  await edit.getByRole("button", { name: "Show change", exact: true }).click();
  await expect(edit.getByText(revisedIntroduction, { exact: false })).toBeVisible();
  await page.reload();
  await expect(edit).toBeVisible();
  await expect(assistant.getByRole("button", { name: "Discard proposal", exact: true })).toHaveCount(0);
  await expect(assistant.getByRole("button", { name: "Apply edit", exact: true })).toHaveCount(0);
  await edit.getByRole("button", { name: "Show change", exact: true }).click();
  await expect(edit.getByText(revisedIntroduction, { exact: false })).toBeVisible();
  await send("Suggest those improvements again");
  await expect(assistant.getByRole("button", { name: "Apply edit", exact: true })).toHaveCount(1);
  await expect(assistant.getByRole("button", { name: "Discard proposal", exact: true })).toHaveCount(3);
  expect(state.outcomePatches).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("changed proposal targets remain untouched and a new request can recover", async ({ page }) => {
  const { state, assistant, send, article } = await sectionProposalHarness(page);
  state.proposals = [sectionProposals[1]];
  await send();
  const changedIntroduction = "The writer has already revised this introduction.";
  await article.locator("p").first().fill(changedIntroduction);
  const edit = assistant.getByRole("region", { name: sectionProposals[1].title, exact: true }).first();
  const apply = edit.getByRole("button", { name: "Apply edit", exact: true });
  // Disabled controls or an explanatory error on activation are both safe recovery paths.
  if (await apply.isEnabled()) await apply.click();
  await expect(article).toContainText(changedIntroduction);
  await expect(article).not.toContainText(revisedIntroduction);
  await expect(
    page
      .getByText(/changed|new suggestion|fresh suggestion|ask again/i)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  state.proposals = [
    {
      ...sectionProposals[1],
      id: "recovered-edit",
      data: { ...sectionProposals[1].data, originalText: `Introduction\n${changedIntroduction}` },
    },
  ];
  await send("Please update the revised introduction");
  const recovered = assistant.getByRole("region", { name: sectionProposals[1].title, exact: true }).last();
  await recovered.getByRole("button", { name: "Apply edit", exact: true }).click();
  await expect(article).toContainText(revisedIntroduction);
  await expect(recovered.getByRole("button", { name: "Apply edit", exact: true })).toHaveCount(0);
  expect(state.outcomePatches).toEqual([]);
  expect(state.errors).toEqual([]);
});

async function historyStateHarness(page: import("@playwright/test").Page, cached = false) {
  page.on("pageerror", (error) => console.log("HISTORY HARNESS ERROR", error.message));
  await page.addInitScript(() => {
    Object.assign(window, { process: { env: { NODE_ENV: "production" } } });
  });
  const config = {
    enabled: true,
    provider: "fixture",
    capabilities: { images: true, webSearch: true, structuredOutput: true, urlRetrieval: false },
  };
  const now = new Date().toISOString();
  const thread = {
    id: "history-thread",
    resourceId: "post",
    integrationKey: "blog",
    title: "Invoice ideas",
    settings: {},
    composerDraft: "",
    createdAt: now,
    updatedAt: now,
  };
  const state = { fail: !cached, hold: false, failDetail: cached, threads: cached ? [thread] : [], release: () => {} };
  await page.route("https://chat-harness.test/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/") return route.fulfill({ contentType: "text/html", body: html });
    if (path === "/api/assistant/blog/config") return route.fulfill({ json: config });
    if (path === "/api/assistant/blog/threads") {
      if (request.method() === "POST") {
        state.threads = [thread];
        state.failDetail = false;
        return route.fulfill({ json: { thread } });
      }
      if (state.hold)
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
      return state.fail
        ? route.fulfill({ status: 503, json: { error: "History temporarily unavailable" } })
        : route.fulfill({ json: { threads: state.threads } });
    }
    if (path.endsWith("/history-thread")) {
      if (state.failDetail) return route.fulfill({ status: 503, json: { error: "Conversation unavailable" } });
      return route.fulfill({ json: { ...config, thread, runs: [], messages: [], attachments: [] } });
    }
    return route.fulfill({ status: 404, json: { error: "Unexpected fixture request" } });
  });
  await page.goto("https://chat-harness.test/");
  return state;
}

test("history failure retries through loading to the designed empty state and starts a thread", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const state = await historyStateHarness(page);
  await page.getByRole("button", { name: "History", exact: true }).click();
  const history = page.getByRole("region", { name: "Conversation history" });
  await expect(history.getByText("Couldn’t load history", { exact: true })).toBeVisible();
  await expect(history.getByText("No conversations yet", { exact: true })).toHaveCount(0);
  await expect(history.getByRole("button", { name: "Back to chat" })).toBeVisible();
  for (const [width, height] of [
    [1366, 768],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `/tmp/blog-history-error-${width}.png` });
  }
  state.hold = true;
  await history.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(history.getByText("Loading conversations…", { exact: true })).toBeVisible();
  await expect(history.getByText("No conversations yet", { exact: true })).toHaveCount(0);
  state.fail = false;
  state.hold = false;
  state.release();
  await expect(history.getByText("No conversations yet", { exact: true })).toBeVisible();
  await expect(history.getByText("Couldn’t load history", { exact: true })).toHaveCount(0);
  await expect(history.getByText("Recent conversations", { exact: true })).toHaveCount(0);
  for (const [width, height] of [
    [1366, 768],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `/tmp/blog-history-empty-${width}.png` });
    await expect(history.getByRole("button", { name: "New thread", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  await history.getByRole("button", { name: "New thread", exact: true }).click();
  await expect(history).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Message to assistant" })).toBeFocused();
});

test("a failed history refresh keeps cached conversations instead of showing empty or error cards", async ({
  page,
}) => {
  const state = await historyStateHarness(page, true);
  await expect(page.getByText("Conversation unavailable", { exact: true })).toBeVisible();
  state.fail = true;
  await page.getByRole("button", { name: "Refresh history", exact: true }).click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  const history = page.getByRole("region", { name: "Conversation history" });
  await expect(history.getByRole("button", { name: /Invoice ideas/ })).toBeVisible();
  await expect(history.getByText("No conversations yet", { exact: true })).toHaveCount(0);
  await expect(history.getByText("Couldn’t load history", { exact: true })).toHaveCount(0);
  await expect(
    page.locator('[data-slot="toast-title"]').filter({ hasText: "History temporarily unavailable" }),
  ).toBeVisible();
});
