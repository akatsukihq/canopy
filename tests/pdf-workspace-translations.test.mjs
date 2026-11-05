import { toolSpec } from "./helpers/toolSpec.mjs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { expect, test, vi } from "vitest";
import { extractToolMessages, toolMessageTree } from "../lib/tool-framework/translations.ts";
import { parseSettings } from "../lib/tool-framework/settings.ts";

vi.mock("@/components/PdfFileWorkspace", () => ({
  PdfFileWorkspace: (props) => {
    try {
      const plan = props.getPlan(props.settings, 4);
      return React.createElement("article", null, React.createElement("h1", null, plan.title), plan.detail);
    } catch (error) {
      return React.createElement("output", null, error.message);
    }
  },
  PdfPageSelectionOverlay: () => null,
}));

async function preview(key, settings, translations = {}) {
  const [{ default: Workspace }, spec] = await Promise.all([import(`../tools/${key}/workspace.tsx`), toolSpec(key)]);
  return renderToStaticMarkup(
    React.createElement(
      NextIntlClientProvider,
      {
        locale: "hi",
        timeZone: "UTC",
        messages: { Tool: toolMessageTree({ ...extractToolMessages(spec), ...translations }) },
      },
      React.createElement(Workspace, {
        spec,
        settings: parseSettings(spec.settings, settings),
        input: { text: "", files: [] },
        onSettingChange() {},
        onInputChange() {},
      }),
    ),
  );
}

test("PDF operation plans retain selected counts when translated through native ICU", async () => {
  expect(
    await preview(
      "resize-pdf-pages",
      { pages: "1-2" },
      { "runtime.workspace.planTitle": "{count, number} पृष्ठ बदले जाएँगे" },
    ),
  ).toContain("2 पृष्ठ बदले जाएँगे");
  expect(
    await preview(
      "split-pdf",
      { mode: "every-page" },
      { "runtime.workspace.planTitle": "{count, number} फ़ाइलें बनेंगी" },
    ),
  ).toContain("4 फ़ाइलें बनेंगी");
  expect(
    await preview(
      "rotate-pdf-pages",
      { pages: "1,3", degrees: "180" },
      { "runtime.workspace.planTitle": "{count, number} में से {selected, number} पृष्ठ: {degrees, number}°" },
    ),
  ).toContain("4 में से 2 पृष्ठ: 180°");
  expect(
    await preview(
      "watermark-pdf",
      { pages: "all", watermarkText: "DRAFT" },
      { "runtime.workspace.planTitle": "{count, number} पृष्ठों पर चिह्न लगेगा" },
    ),
  ).toContain("4 पृष्ठों पर चिह्न लगेगा");
});

test("PDF previews localize recoverable input errors without parsing English messages", async () => {
  expect(
    await preview(
      "resize-pdf-pages",
      { pages: "9" },
      { "runtime.workspace.choosePages": "1 से {count, number} तक पृष्ठ चुनें" },
    ),
  ).toContain("1 से 4 तक पृष्ठ चुनें");
  expect(
    await preview("watermark-pdf", { watermarkText: "" }, { "runtime.workspace.enterText": "चिह्न का पाठ दर्ज करें" }),
  ).toContain("चिह्न का पाठ दर्ज करें");
});
