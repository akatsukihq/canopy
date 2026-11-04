import { defineCodeTool } from "../../lib/code-execution/definition.ts";

export default defineCodeTool("python-compiler", {
  name: "Python Compiler",
  label: "Python",
  mark: "PY",
  compiled: false,
  keywords: ["python", "python compiler", "online python", "run python", "python interpreter", "python playground"],
  faq: {
    q: "Can I use pip packages or import third-party libraries?",
    a: "No. Only the Python standard library is available, because the sandbox has no network access and packages cannot be installed.",
  },
});
