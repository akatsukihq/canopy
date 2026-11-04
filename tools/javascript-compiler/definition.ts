import { defineCodeTool } from "../../lib/code-execution/definition.ts";

export default defineCodeTool("javascript-compiler", {
  name: "JavaScript Compiler",
  label: "JavaScript",
  mark: "JS",
  compiled: false,
  syntax: "javascript",
  keywords: ["javascript", "node", "node.js", "online javascript", "run javascript", "js compiler"],
  faq: {
    q: "Is this Node.js or a browser?",
    a: "It is Node.js, not a browser. There is no document or window, but console.log, require and the built-in Node modules work. Read input with fs.readFileSync(0).",
  },
});
