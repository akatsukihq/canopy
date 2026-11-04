import { defineCodeTool } from "../../lib/code-execution/definition.ts";

export default defineCodeTool("csharp-compiler", {
  name: "C# Compiler",
  label: "C#",
  mark: "C#",
  compiled: true,
  keywords: ["c#", "csharp", "c# compiler", "online c#", "run c#", ".net", "dotnet"],
  faq: {
    q: "Can I use NuGet packages?",
    a: "No. Only the .NET base class libraries are available, because the sandbox has no network access and packages cannot be installed.",
  },
});
