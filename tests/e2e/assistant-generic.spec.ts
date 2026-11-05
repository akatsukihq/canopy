import { build } from "esbuild";
import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
let html: string;
test.beforeAll(async () => {
  const root = process.cwd();
  const directory = await mkdtemp(resolve(tmpdir(), "canopy-assistant-generic-"));
  const entry = resolve(directory, "entry.tsx");
  await writeFile(
    entry,
    `
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {AssistantPanel} from '${root}/components/assistant/AssistantPanel.tsx';
 import {Toaster} from '${root}/components/ui/index.tsx';
 const now=new Date().toISOString();const expiresAt=new Date(Date.now()+86400000).toISOString();
 const available={enabled:true,provider:'fixture',capabilities:{images:false,webSearch:false,structuredOutput:true,urlRetrieval:false}};
 window.fixture={calls:[],applied:0,fail:true,release:null};
 window.fetch=async(input,init)=>{const url=new URL(String(input),'https://generic-assistant.test');const key=url.pathname.split('/')[3];const method=init?.method??'GET';const body=typeof init?.body==='string'?JSON.parse(init.body):{};window.fixture.calls.push({url:url.pathname+url.search,key,method,body});
 const thread={id:'thread',integrationKey:key,resourceId:'same',title:key+' conversation',type:'chat',settings:{},composerDraft:'',composerState:{attachmentIds:[]},createdAt:now,updatedAt:now};
 const attachment={id:'artifact',threadId:'thread',runId:'run',messageId:null,type:'artifact',label:key+' result',status:'ready',expiresAt,createdAt:now,updatedAt:now,data:{artifact:{schemaVersion:1,agentVersion:1,agentId:key,summary:'A useful summary',content:{}}}};
 const execution={id:'run',operation:'summarize',executionMode:'standalone',status:'completed',agentId:key,label:key+' result',requestMessage:'Summarize the content',artifact:{attachmentId:'artifact',agentId:key,label:key+' result',summary:'A useful summary'},createdAt:now,updatedAt:now,completedAt:now,expiresAt,errorMessage:null};
 if(url.pathname.endsWith('/config'))return Response.json(available);
 if(url.pathname.endsWith('/runs')){const run={id:'new-run',integrationKey:key,resourceId:'same',threadId:'thread',executionMode:'standalone',operation:body.operation,status:'completed',provider:'fixture',model:'fixture',inputMessageId:null,assistantMessageId:null,request:body,response:{text:'',citations:[],proposals:[],artifact:execution.artifact},errorMessage:null,createdAt:now,updatedAt:now,completedAt:now};return new Response(JSON.stringify({type:'run',run})+'\\n'+JSON.stringify({type:'completed',run})+'\\n',{headers:{'Content-Type':'application/x-ndjson'}});}

 if(url.pathname.endsWith('/threads'))return Response.json(method==='POST'?{thread}:{threads:[thread]});
 if(url.pathname.endsWith('/attachments/artifact'))return Response.json({attachment,html:'<p>Complete proposed content.</p>'});
 if(url.pathname.endsWith('/attachments'))return Response.json({attachments:url.searchParams.get('kind')==='sources'?[]:[attachment],nextCursor:null});
 if(url.pathname.endsWith('/threads/thread'))return Response.json(method==='PATCH'?{thread:{...thread,...body}}:{...available,thread,runs:[],messages:[],attachments:[],executions:[execution]});
 return Response.json({error:'Unexpected fixture request'},{status:404});};
 function Pane({name}){const [applied,setApplied]=React.useState(false);const current=React.useRef(false);current.current=applied;
 const integration={key:name,conversationOperation:'ask',agentOperation:'summarize',selectSettings:[name==='notes'?{key:'notesFormat',label:'Notes format',options:['Brief','Detailed']}:{key:'priority',label:'Task priority',options:['Normal','Urgent']}],agents:[{id:name,name:name+' helper',command:name,aliases:[],description:'Helps with '+name}],resourceLabel:name,resourceTitle:'Shared resource identifier',contextLabel:'Current content',contextDescription:'Use current content as context.',launchTitle:'Work with '+name,placeholder:'Ask about '+name,enabled:true,launchActions:[],contextProblem:()=>'',prepareRequest:input=>({input:{operation:input.operation,message:input.message,agentId:input.agentId,settings:input.settings,attachmentIds:input.attachmentIds,context:{text:'Current '+name}}}),response:()=>({changes:[]}),executionStale:()=>false,artifact:(attachment,html)=>({supported:true,text:'A useful summary',report:{summary:'A useful summary',sections:[{heading:'Findings',items:['An actionable item']}]},changeset:{title:'Review proposed content',previewLabel:'Preview changes',applyLabel:'Apply changes',keepLabel:'Keep current content',description:'Apply the reviewed content.',contentTitle:'Proposed '+name,html,eligibility:()=>({stale:false,expired:false,alreadyApplied:current.current,hasUndo:current.current,canUndo:current.current}),onApply:async()=>{window.fixture.applied++;await new Promise(resolve=>window.fixture.release=resolve);if(window.fixture.fail)throw new Error('Application failed; try again.');setApplied(true);},onUndo:()=>setApplied(false)}})};
 return <section aria-label={name+' assistant'} style={{height:'calc(100vh - 32px)',minWidth:0,flex:1,border:'1px solid var(--border)'}}><AssistantPanel ownerId='owner' resourceId='same' integration={integration}/></section>;}
 function App(){return <main className='platform-shell' style={{display:'flex',gap:16,padding:16}}><Pane name='notes'/><Pane name='tasks'/><Toaster/></main>;}createRoot(document.getElementById('root')).render(<App/>);
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
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    loader: { ".png": "dataurl", ".svg": "dataurl", ".woff2": "dataurl", ".woff": "dataurl", ".ttf": "dataurl" },
  });
  const js = bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
  const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
  const globals = await postcss([tailwind({ base: root })]).process(
    await readFile(resolve(root, "app/globals.css"), "utf8"),
    { from: resolve(root, "app/globals.css") },
  );
  html =
    "<!doctype html><html><head><style>" +
    globals.css +
    "\n" +
    css +
    '</style></head><body><div id="root"></div><script>' +
    js.replaceAll("</script", "<\\/script") +
    "</script></body></html>";
});
test("non-Blog integrations share full UI, isolate catalogs and drafts, and await recoverable application", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.stack);
  });
  await page.route("https://generic-assistant.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("https://generic-assistant.test/");
  const notes = page.getByRole("region", { name: "notes assistant" });
  const tasks = page.getByRole("region", { name: "tasks assistant" });
  const noteInput = notes.getByRole("combobox", { name: "Message to assistant" });
  const taskInput = tasks.getByRole("combobox", { name: "Message to assistant" });
  await noteInput.fill("/");
  await notes.getByRole("option", { name: /notes helper/ }).click();
  await expect(notes.getByText("notes helper", { exact: true }).last()).toBeVisible();
  await expect(tasks.getByText("notes helper", { exact: true })).toHaveCount(0);
  await noteInput.press("End");
  await noteInput.pressSequentially("Keep my notes");
  await taskInput.fill("Keep my tasks");
  await notes.getByRole("button", { name: "Assistant settings", exact: true }).click();
  await page.getByText("More settings", { exact: true }).click();
  await page.getByLabel("Notes format", { exact: true }).click();
  await page.getByRole("option", { name: "Detailed", exact: true }).click();
  await page.getByRole("button", { name: "Close assistant settings", exact: true }).click();
  await tasks.getByRole("button", { name: "Assistant settings", exact: true }).click();
  await page.getByText("More settings", { exact: true }).click();
  await page.getByLabel("Task priority", { exact: true }).click();
  await page.getByRole("option", { name: "Urgent", exact: true }).click();
  await page.getByRole("button", { name: "Close assistant settings", exact: true }).click();

  expect(
    await page.locator("[id]").evaluateAll((nodes) => {
      const ids = nodes.map((node) => node.id);
      return ids.length === new Set(ids).size;
    }),
  ).toBe(true);
  await notes.getByRole("button", { name: "Use notes result", exact: true }).click();
  await notes.getByRole("button", { name: "Preview changes", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Complete proposed content.")).toBeVisible();
  const apply = dialog.getByRole("button", { name: "Apply changes", exact: true });
  await apply.click();
  await expect(apply).toBeDisabled();
  await page.evaluate(() => {
    (window as unknown as { fixture: { release: () => void } }).fixture.release();
  });
  await expect(dialog).toBeVisible();
  await expect(
    page.locator('[data-slot="toast-title"]').filter({ hasText: "Application failed; try again." }),
  ).toBeVisible();
  await expect(apply).toBeEnabled();
  await page.evaluate(() => {
    (window as unknown as { fixture: { fail: boolean } }).fixture.fail = false;
  });
  await apply.click();
  await page.evaluate(() => {
    (window as unknown as { fixture: { release: () => void } }).fixture.release();
  });
  await expect(dialog).toHaveCount(0);
  await expect(notes.getByRole("button", { name: "Undo replacement" })).toBeEnabled();
  await notes.getByRole("button", { name: "Undo replacement" }).click();
  await expect(notes.getByRole("button", { name: "Undo replacement" })).toHaveCount(0);
  await notes.getByRole("button", { name: "Back to chat" }).click();
  await expect(noteInput).toContainText("Keep my notes");
  await expect(taskInput).toHaveText("Keep my tasks");
  await notes.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(noteInput).not.toContainText("Keep my notes");
  await expect(taskInput).toHaveText("Keep my tasks");
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const state = await page.evaluate(() => {
    const fixture = (
      window as unknown as {
        fixture: {
          applied: number;
          calls: Array<{
            url: string;
            key: string;
            body: { settings?: Record<string, string>; operation?: string; context?: Record<string, unknown> };
          }>;
        };
      }
    ).fixture;
    return {
      applied: fixture.applied,
      urls: fixture.calls.map((call) => call.url),
      submissions: fixture.calls
        .filter((call) => call.url.endsWith("/runs"))
        .map((call) => ({ key: call.key, body: call.body })),
      settings: fixture.calls
        .filter((call) => call.body.settings)
        .map((call) => ({ key: call.key, settings: call.body.settings })),
      keys: Object.keys(sessionStorage),
    };
  });
  expect(state.applied).toBe(2);
  expect(state.submissions).toHaveLength(1);
  expect(state.submissions[0]).toMatchObject({
    key: "notes",
    body: { operation: "summarize", context: { text: "Current notes" }, settings: { notesFormat: "Detailed" } },
  });
  expect(state.submissions[0].body).not.toHaveProperty("postId");
  expect(state.settings).toContainEqual({ key: "notes", settings: { notesFormat: "Detailed" } });
  expect(state.settings).toContainEqual({ key: "tasks", settings: { priority: "Urgent" } });
  expect(
    state.urls.every((url) => url.startsWith("/api/assistant/notes/") || url.startsWith("/api/assistant/tasks/")),
  ).toBe(true);
  expect(state.keys.some((key) => key.includes('["owner","notes","same"]'))).toBe(true);
  expect(state.keys.some((key) => key.includes('["owner","tasks","same"]'))).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "/tmp/canopy-assistant-generic-1280.png" });
});
