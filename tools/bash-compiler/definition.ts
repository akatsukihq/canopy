import { defineCodeTool } from "../../lib/code-execution/definition.ts";

export default defineCodeTool("bash-compiler", {
  name: "Bash Compiler",
  label: "Bash",
  mark: "SH",
  compiled: false,
  syntax: "bash",
  keywords: ["bash", "shell", "bash compiler", "online bash", "run bash", "shell script"],
  faq: {
    q: "Which commands can I use?",
    a: "Bash built-ins and the basic tools installed in the sandbox. There is no network, so commands such as curl cannot reach anything.",
  },
});
