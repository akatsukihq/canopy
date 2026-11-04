import { defineCodeTool } from "../../lib/code-execution/definition.ts";

export default defineCodeTool("go-compiler", {
  name: "Go Compiler",
  label: "Go",
  mark: "GO",
  compiled: true,
  keywords: ["go", "golang", "go compiler", "online go", "run go", "go playground"],
  faq: {
    q: "Why does my newer Go syntax fail?",
    a: "This page runs an older Go release, so features added later, such as some generics improvements, may not compile. The pinned version is shown above.",
  },
});
