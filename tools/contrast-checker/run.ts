import type { ToolRun } from "../../lib/tool-framework/run.ts";
import { contrast, CONTRAST_CHECKS } from "./model.ts";
type Settings = {
  readonly foreground: string;
  readonly background: string;
  readonly canvas: string;
  readonly sample: string;
  readonly bodySample: string;
};
export const run: ToolRun<Settings> = ({ settings }) => {
  const value = contrast(
    settings.foreground ?? "#334155",
    settings.background ?? "#FFFFFF",
    settings.canvas ?? "#FFFFFF",
  );
  const entries = [
    { label: "Contrast ratio", labelMessage: { key: "contrast.ratio" }, value: `${value.ratio.toFixed(2)}:1` },
    ...CONTRAST_CHECKS.map((check, index) => ({
      label: check.label,
      labelMessage: { key: `contrast.check.${index}` },
      value: value.ratio >= check.minimum ? "Pass" : "Fail",
      valueMessage: { key: value.ratio >= check.minimum ? "contrast.pass" : "contrast.fail" },
    })),
    { label: "Displayed text", labelMessage: { key: "contrast.displayedText" }, value: value.foreground },
    { label: "Displayed background", labelMessage: { key: "contrast.displayedBackground" }, value: value.background },
  ];
  return {
    render: "key-value",
    entries,
    artifacts: [
      {
        storage: "inline",
        name: "contrast-report.txt",
        mimeType: "text/plain",
        content: entries.map((entry) => `${entry.label}: ${entry.value}`).join("\n"),
      },
    ],
    verdict: {
      level: value.ratio >= 4.5 ? "ok" : "warn",
      label: value.ratio >= 4.5 ? "AA normal text passes" : "AA normal text fails",
      labelMessage: { key: value.ratio >= 4.5 ? "contrast.aaPass" : "contrast.aaFail" },
    },
  };
};
export default run;
