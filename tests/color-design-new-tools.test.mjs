import { toolSpec } from "./helpers/toolSpec.mjs";
import { test, expect } from "vitest";
import { contrast, suggestForeground } from "../tools/contrast-checker/model.ts";
import { run as checkContrast } from "../tools/contrast-checker/run.ts";
import { generatePalette, readPalette } from "../tools/palette-generator/model.ts";
import { run as exportPalette } from "../tools/palette-generator/run.ts";
import { parseSettings } from "../lib/tool-framework/settings.ts";
const contrastDefinition = await toolSpec("contrast-checker");
const paletteDefinition = await toolSpec("palette-generator");

test("contrast has exact WCAG bounds and composites transparent layers in order", () => {
  expect(contrast("black", "white", "white").ratio).toBe(21);
  expect(contrast("white", "white", "white").ratio).toBe(1);
  const value = contrast("rgb(0 0 0 / 50%)", "transparent", "white");
  expect(value.foreground).toBe("rgb(127.5 127.5 127.5)");
  expect(value.ratio > 3.97 && value.ratio < 3.98).toBeTruthy();
  expect(() => contrast("black", "white", "transparent")).toThrow(/opaque/);
  expect(() => contrast("garbage", "white", "white")).toThrow();
  const report = checkContrast({ settings: { foreground: "#777", background: "white", canvas: "white" } });
  expect(report.entries.find((row) => row.label === "AA · normal text").value).toBe("Fail");
});

test("runtime setting parsing retains CSS colors and contrast preview preserves fractional channels", () => {
  const settings = parseSettings(contrastDefinition.settings, {
    foreground: "black",
    background: "white",
    canvas: "white",
  });
  expect(checkContrast({ settings }).entries[0].value).toBe("21.00:1");
  const value = contrast("rgb(0 0 0 / 0.5349)", "white", "white");
  expect(value.ratio >= 4.5).toBeTruthy();
  expect(Math.abs(contrast(value.foreground, value.background).ratio - value.ratio) < 1e-12).toBeTruthy();
  const paletteSettings = parseSettings(paletteDefinition.settings, { seed: "red" });
  expect(exportPalette({ settings: paletteSettings }).tablePreview.rows[0][1]).toBe("#FF0000");
  const invalid = parseSettings(contrastDefinition.settings, { foreground: "invalid" });
  expect(() => checkContrast({ settings: invalid })).toThrow();
});

test("suggested foreground reaches the requested threshold on the actual background", () => {
  for (const background of ["white", "black", "#777", "#3366ff80"]) {
    const suggested = suggestForeground("#7799bb80", background, "white", 4.5);
    expect(contrast(suggested, background, "white").ratio >= 4.5).toBeTruthy();
  }
});

test("palette generation is deterministic, respects count and keeps locked colors", () => {
  const palette = generatePalette("#3366ff", "analogous", 5, 0);
  expect(generatePalette("#3366ff", "analogous", 5, 0)).toEqual(palette);
  expect(palette.length).toBe(5);
  expect(palette[0].color).toBe("#3366FF");
  const previous = palette.map((item, index) => ({ ...item, locked: index === 2 }));
  const next = generatePalette("red", "triadic", 5, 1, previous);
  expect(next[2]).toEqual(previous[2]);
  expect(next[1].color).not.toBe(previous[1].color);
  expect(() => generatePalette("red", "analogous", 2, 0, previous)).toThrow(/Unlock/);
  expect(() => generatePalette("red", "bogus", 5, 0)).toThrow();
  expect(() => generatePalette("red", "analogous", 20, 0)).toThrow();
  expect(() => readPalette('[{"id":"a","color":"red;url(x)"}]')).toThrow();
});

test("palette export keeps order and produces usable CSS, JSON and SVG", () => {
  const settings = { seed: "#3366ff", harmony: "analogous", count: 3, variation: 0, colors: "", format: "css" };
  const result = exportPalette({ settings });
  expect(result.code).toMatch(/--color-1: #3366FF;/);
  expect(result.artifacts.length).toBe(3);
  const json = result.artifacts.find((a) => a.name.endsWith(".json"));
  expect(JSON.parse(json.content)[0].color).toBe("#3366FF");
  const svg = result.artifacts.find((a) => a.name.endsWith(".svg"));
  expect(svg.content).toMatch(/<svg/);
  expect(result.tablePreview.rows.length).toBe(3);
});
