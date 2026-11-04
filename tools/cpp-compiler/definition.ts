import { defineCodeTool } from "../../lib/code-execution/definition.ts";

export default defineCodeTool("cpp-compiler", {
  name: "C++ Compiler",
  label: "C++",
  mark: "C++",
  compiled: true,
  keywords: ["c++", "cpp", "c++ compiler", "online c++", "run c++", "g++"],
  faq: {
    q: "Which C++ standard is available?",
    a: "The code is compiled with GCC's g++. The newest language standards may not be fully supported by this older compiler version.",
  },
});
