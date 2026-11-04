import { runCode, type CodeSettings } from "@/lib/code-execution/run";
import type { ToolRun } from "@/lib/tool-framework/run";

export const run: ToolRun<CodeSettings> = ({ input, settings, signal }) =>
  runCode("java-compiler", input, signal, settings.version);
export default run;
