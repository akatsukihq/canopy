import { defineCodeTool } from "../../lib/code-execution/definition.ts";

export default defineCodeTool("c-compiler", {
  name: "C Compiler",
  label: "C",
  mark: "C",
  compiled: true,
  keywords: ["c", "c compiler", "online c", "run c", "gcc", "c playground"],
  faq: {
    q: "Which compiler is used?",
    a: "GCC. The program is compiled and then run, and compiler warnings and errors appear in the result with their line numbers.",
  },
});
