import { defineCodeTool } from "../../lib/code-execution/definition.ts";

export default defineCodeTool("typescript-compiler", {
  name: "TypeScript Compiler",
  label: "TypeScript",
  mark: "TS",
  compiled: true,
  syntax: "typescript",
  keywords: ["typescript", "online typescript", "run typescript", "ts compiler", "tsc", "typescript playground"],
  faq: {
    q: "Does TypeScript check my types before running?",
    a: "Yes. The code is compiled first, so type errors are shown as compile errors with the line number, and nothing runs until they are fixed.",
  },
});
