import { defineCodeTool } from "../../lib/code-execution/definition.ts";

export default defineCodeTool("ruby-compiler", {
  name: "Ruby Compiler",
  label: "Ruby",
  mark: "RB",
  compiled: false,
  keywords: ["ruby", "ruby compiler", "online ruby", "run ruby", "ruby interpreter", "ruby playground"],
  faq: {
    q: "Can I install gems?",
    a: "No. Only the Ruby standard library is available, because the sandbox has no network access and gems cannot be installed.",
  },
});
