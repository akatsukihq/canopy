import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult, ToolValidationIssue } from "../../lib/tool-framework/result.ts";

type Settings = {
  readonly from: string;
  readonly to: string;
  readonly base: number;
  readonly elementFontSize: number;
  readonly parentFontSize: number;
  readonly emContext: string;
  readonly percentageReference: string;
  readonly percentageBase: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly precision: number;
  readonly roundResults: boolean;
  readonly includeFormula: boolean;
};
const UNITS = ["px", "rem", "em", "pt", "%", "vw", "vh", "vmin", "vmax"];
const REFERENCE_LABELS = {
  root: "Root font size",
  parent: "Parent font size",
  element: "Element font size",
  percentage: "Percentage reference length",
  width: "Viewport width",
  height: "Viewport height",
} as const;
const VALUE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|rem|em|pt|%|vw|vh|vmin|vmax)?$/i;

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const settings = ctx.settings;
  if (!UNITS.includes(settings.from) || !UNITS.includes(settings.to))
    throw new ToolError("invalid-unit", "Choose a supported CSS unit.", undefined, { messageRef: { key: "css.unit" } });
  const precision = settings.roundResults ? 4 : (settings.precision ?? 6);
  if (!Number.isInteger(precision) || precision < 0 || precision > 12)
    throw new ToolError("invalid-precision", "Precision must be a whole number from 0 to 12.", undefined, {
      messageRef: { key: "css.precision" },
    });

  function positive(value: number, reference: keyof typeof REFERENCE_LABELS) {
    if (!Number.isFinite(value) || value <= 0)
      throw new ToolError(
        "invalid-reference",
        `${REFERENCE_LABELS[reference]} must be a finite, positive number.`,
        undefined,
        { messageRef: { key: "css.positiveReference", values: { reference } } },
      );
    return value;
  }
  function pixels(unit: string): number {
    switch (unit) {
      case "px":
        return 1;
      case "pt":
        return 96 / 72;
      case "rem":
        return positive(settings.base, "root");
      case "em":
        return settings.emContext === "parent"
          ? positive(settings.parentFontSize ?? settings.base, "parent")
          : positive(settings.elementFontSize ?? settings.base, "element");
      case "%":
        return settings.percentageReference === "length"
          ? positive(settings.percentageBase, "percentage") / 100
          : positive(settings.parentFontSize ?? settings.base, "parent") / 100;
      case "vw":
        return positive(settings.viewportWidth ?? 1366, "width") / 100;
      case "vh":
        return positive(settings.viewportHeight ?? 768, "height") / 100;
      case "vmin":
        return Math.min(pixels("vw"), pixels("vh"));
      case "vmax":
        return Math.max(pixels("vw"), pixels("vh"));
      default:
        throw new ToolError("invalid-unit", "Choose a supported CSS unit.", undefined, {
          messageRef: { key: "css.unit" },
        });
    }
  }

  function convert(input: string) {
    const match = VALUE.exec(input);
    if (!match)
      throw new ToolError("invalid-value", "Enter a number, optionally followed by a supported CSS unit.", undefined, {
        messageRef: { key: "css.numberRequired" },
      });
    const value = Number(match[1]);
    if (!Number.isFinite(value))
      throw new ToolError("invalid-value", "The value is too large; enter a finite number.", undefined, {
        messageRef: { key: "css.finiteNumber" },
      });
    const from = match[2]?.toLowerCase() ?? settings.from;
    const factor = pixels(from) / pixels(settings.to);
    const result = value * factor;
    if (!Number.isFinite(result))
      throw new ToolError(
        "overflow",
        "The converted value is too large. Reduce the value or its reference size.",
        undefined,
        { messageRef: { key: "css.overflow" } },
      );
    const converted = `${Number(result.toFixed(precision))}${settings.to}`;
    const formula = `${value}${from} × ${Number(factor.toPrecision(12))} ≈ ${converted}`;
    return { converted, formula };
  }

  const lines = ctx.input.text
    .split(/\r?\n/)
    .map((text, index) => ({ text: text.trim(), line: index + 1 }))
    .filter(({ text }) => text);
  if (lines.length === 0)
    throw new ToolError("empty-value", "Enter a CSS value to convert.", undefined, {
      messageRef: { key: "css.valueRequired" },
    });
  if (lines.length === 1) {
    const { converted, formula } = convert(lines[0].text);
    return { render: "text", text: settings.includeFormula ? `${converted}\nFormula: ${formula}` : converted };
  }

  const issues: ToolValidationIssue[] = [];
  const rows = lines.map(({ text, line }) => {
    try {
      const { converted, formula } = convert(text);
      return [String(line), text, converted, ...(settings.includeFormula ? [formula] : [])];
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not convert this value.";
      issues.push({
        target: "input",
        line,
        message,
        messageRef: error instanceof ToolError ? error.details?.messageRef : { key: "css.failed" },
      });
      return [String(line), text, "", ...(settings.includeFormula ? [""] : [])];
    }
  });
  return {
    render: "table",
    columns: ["Line", "Input", "Result", ...(settings.includeFormula ? ["Formula"] : [])],
    rows,
    columnMessages: ["line", "input", "result", ...(settings.includeFormula ? ["formula"] : [])].map((key) => ({
      key: `css.columns.${key}`,
    })),
    ...(issues.length
      ? {
          issues,
          verdict: {
            level: "warn" as const,
            label: `${lines.length - issues.length} converted · ${issues.length} need correction`,
            labelMessage: {
              key: "css.converted",
              values: { converted: lines.length - issues.length, corrections: issues.length },
            },
          },
        }
      : {}),
  };
};

export default run;
