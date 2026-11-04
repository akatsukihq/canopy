import { defineCodeTool } from "../../lib/code-execution/definition.ts";

export default defineCodeTool("kotlin-compiler", {
  name: "Kotlin Compiler",
  label: "Kotlin",
  mark: "KT",
  compiled: true,
  keywords: ["kotlin", "kotlin compiler", "online kotlin", "run kotlin", "kotlinc", "kotlin playground"],
  faq: {
    q: "Why is Kotlin slower to start than other languages?",
    a: "Kotlin is compiled on every run and starts the Java virtual machine, so the first seconds are spent preparing. Short programs still finish well inside the limit.",
  },
});
