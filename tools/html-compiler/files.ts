/** The three editor files travel through the tool framework as one JSON text. */
export type WebFiles = { readonly html: string; readonly css: string; readonly js: string };

export const WEB_STARTER: WebFiles = {
  html: `<main>
  <h1>Hello, <span id="name">world</span>!</h1>
  <button id="greet">Say hi</button>
</main>
`,
  css: `body {
  font-family: system-ui, sans-serif;
  display: grid;
  place-items: center;
  min-height: 100vh;
  margin: 0;
}

button {
  padding: 0.5rem 1rem;
  font-size: 1rem;
}
`,
  js: `document.getElementById("greet").addEventListener("click", () => {
  document.getElementById("name").textContent = "Ada";
  console.log("Button clicked");
});
`,
};

export function parseWebFiles(text: string): WebFiles {
  try {
    const value = JSON.parse(text) as Partial<Record<keyof WebFiles, unknown>>;
    return {
      html: typeof value.html === "string" ? value.html : "",
      css: typeof value.css === "string" ? value.css : "",
      js: typeof value.js === "string" ? value.js : "",
    };
  } catch {
    return { html: "", css: "", js: "" };
  }
}

export const stringifyWebFiles = (files: WebFiles): string => JSON.stringify(files);

/** Reports console output and errors to the parent page; the preview iframe has an opaque origin. */
const CONSOLE_BRIDGE = `(function(){
  var send = function(level, args){
    var text = Array.prototype.map.call(args, function(a){
      if (typeof a === "string") return a;
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    }).join(" ");
    parent.postMessage({ canopyConsole: true, level: level, text: text }, "*");
  };
  ["log","info","warn","error"].forEach(function(level){
    var original = console[level];
    console[level] = function(){ send(level, arguments); original.apply(console, arguments); };
  });
  window.addEventListener("error", function(e){ send("error", [e.message + (e.lineno ? " (line " + e.lineno + ")" : "")]); });
  window.addEventListener("unhandledrejection", function(e){ send("error", ["Unhandled promise rejection: " + e.reason]); });
})();`;

export function buildDocument({ html, css, js }: WebFiles): string {
  const script = js.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>${CONSOLE_BRIDGE}</script>
<style>
${css.replace(/<\/style/gi, "<\\/style")}
</style>
</head>
<body>
${html}
<script>
${script}
</script>
</body>
</html>
`;
}
