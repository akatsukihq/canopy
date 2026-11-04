import type { ToolSpec } from "../../lib/tool-framework/spec";

/** The starter page, as the JSON the workspace keeps in `input.text` (see files.ts WEB_STARTER). */
const STARTER = JSON.stringify({
  html: '<main>\n  <h1>Hello, <span id="name">world</span>!</h1>\n  <button id="greet">Say hi</button>\n</main>\n',
  css: "body {\n  font-family: system-ui, sans-serif;\n  display: grid;\n  place-items: center;\n  min-height: 100vh;\n  margin: 0;\n}\n\nbutton {\n  padding: 0.5rem 1rem;\n  font-size: 1rem;\n}\n",
  js: 'document.getElementById("greet").addEventListener("click", () => {\n  document.getElementById("name").textContent = "Ada";\n  console.log("Button clicked");\n});\n',
});

export default {
  messages: {
    "workspace.editor": "{file} source code",
    "workspace.preview": "Preview",
    "workspace.previewEmpty": "Press Run to show your page here.",
    "workspace.previewFrame": "Preview of your page",
    "workspace.console": "Console",
    "workspace.consoleEmpty": "Nothing logged yet. Use console.log in script.js and it appears here.",
    "workspace.consoleClear": "Clear console",
    "workspace.consoleCount": "{count, plural, one {# message} other {# messages}}",
    "workspace.download": "Download page",
    "workspace.upload": "Upload {file}",
    "workspace.downloadFile": "Download {file}",
    "workspace.uploadFailed": "{name} could not be read as text.",
    "workspace.uploadTooLarge": "{name} is larger than {max} KiB. Choose a smaller file.",
  },
  toolId: "devtools.html-compiler",
  app: "devtools",
  category: "compilers",
  keywords: ["html", "css", "javascript", "html compiler", "online html editor", "html playground", "run html"],
  name: "HTML Compiler",
  description: "Write HTML, CSS and JavaScript and see your page run live in your browser.",
  input: {
    kind: "text",
    language: "html",
    label: "Page files",
    maxLength: 196_608,
    placeholder: "",
  },
  settings: { fields: {} },
  trigger: { mode: "manual", actionLabel: "Run" },
  capabilities: {},
  workbenchMark: { text: "HTML", tone: "contrast" },
  labels: {
    result: "Preview",
    empty: "Press Run to show your page here.",
    ready: "Your page is running in the preview.",
    running: "Building your page…",
  },
  content: {
    howToUse: [
      "The editor starts with a small page: a heading, a button and a script, so you can press Run straight away.",
      "Edit index.html for the page structure, style.css for its look and script.js for its behaviour. Use the tabs to switch files.",
      "Press Run or Ctrl/Cmd+Enter. Your page appears in the preview and anything you log with console.log appears in the console below it.",
      "If your script throws an error, the console shows the message and line. Fix the code and run again.",
    ],
    limitations: [
      "Everything runs in your browser. Your code is never sent to a server.",
      "The page runs in an isolated frame: no access to this site's data, no cookies and no local storage that lasts.",
      "Only one HTML page is supported. Imports of other files from your computer do not work, but full URLs for scripts and styles do.",
      "The three files are limited to 192 KiB in total.",
    ],
    faq: [
      {
        q: "Is my code sent to a server?",
        a: "No. The page is built and shown inside your browser tab. Nothing is uploaded.",
      },
      {
        q: "Can I use JavaScript libraries?",
        a: "Yes. Add a script tag with a full URL to index.html and the library loads when your page runs.",
      },
      {
        q: "Why does my alert or popup not show?",
        a: "Popups can be blocked by your browser. Use console.log to inspect values instead.",
      },
    ],
    examples: [{ label: "Starter", text: STARTER }],
  },
} as const satisfies ToolSpec;
