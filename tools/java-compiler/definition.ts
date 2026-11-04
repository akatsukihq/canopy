import { defineCodeTool } from "../../lib/code-execution/definition.ts";

export default defineCodeTool("java-compiler", {
  name: "Java Compiler",
  label: "Java",
  mark: "JV",
  compiled: true,
  keywords: ["java", "java compiler", "online java", "run java", "javac", "java playground"],
  faq: {
    q: "Why must the class be called Main?",
    a: "The file is saved as Main.java, so the public class must be named Main and contain the main method.",
  },
});
