import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";

const workspacePath = "app/paperwork/components/AdvancedTemplateWorkspace.tsx";
const adaptersPath = "lib/paperwork/documentAdapters.ts";
const editorPath = "app/admin/(protected)/templates/[id]/advanced/components/AdvancedTemplateEditor.tsx";

test("Paperwork exposes one typed adapter and component mapping for every document kind", async () => {
  const source = await readFile(adaptersPath, "utf8");

  expect(source).toMatch(/export interface DocumentAdapter<TDraft>/);
  for (const documentType of [
    "invoice",
    "receipt",
    "expense-report",
    "mileage-log",
    "quarterly-tax-estimator",
    "w9-request",
    "1099-nec-tracker",
  ]) {
    expect(source).toMatch(new RegExp(`documentType:\\s*"${documentType}"`));
  }
  for (const method of [
    "getInitialDraft",
    "getSampleDraft",
    "readField",
    "writeField",
    "validate",
    "toPdfInputs",
    "fileName",
  ]) {
    expect(source).toMatch(new RegExp(`${method}\\s*[:(]`));
  }
  expect(source).toMatch(/sampleData[\s\S]*builtInValues[\s\S]*customValues/);
  expect(source).not.toMatch(/\beval\s*\(|new Function\s*\(/);
});

test("the shared advanced workspace renders published form configuration and isolates custom values by template", async () => {
  const source = await readFile(workspacePath, "utf8");

  expect(source).toMatch(/^"use client";/);
  expect(source).toMatch(/config\.form\.sections/);
  expect(source).toMatch(/AdvancedDocumentPreview/);
  expect(source).toMatch(/downloadAdvancedDocumentPdf/);
  expect(source).toMatch(/openAdvancedDocumentPdf/);
  expect(source).toMatch(/OrderableList/);
  expect(source).toMatch(/template\.id/);
  expect(source).toMatch(/templateCustomSampleValues/);
  expect(source).toMatch(/localStorage/);
  expect(source).toMatch(/MAX_RUNTIME_REPEATER_ROWS\s*=\s*500/);
  expect(source).toMatch(/slice\(0,\s*MAX_RUNTIME_REPEATER_ROWS\)/);
  expect(source).toMatch(/containsFullTin/);
  expect(source).toMatch(/control === "number"/);
  expect(source).toMatch(/control === "date"/);
  expect(source).toMatch(/<CheckboxControl\b/);
  expect(source).not.toMatch(/dangerouslySetInnerHTML/);
});

test("the admin fields panel is registry-driven and edits ordered form sections", async () => {
  const source = await readFile(editorPath, "utf8");

  expect(source).toMatch(/getDocumentDefinition/);
  expect(source).toMatch(/Fields & data/);
  expect(source).toMatch(/form\.sections/);
  expect(source).toMatch(/OrderableList/);
  expect(source).toMatch(/custom\./);
  expect(source).toMatch(/Add custom field/);
  expect(source).toMatch(/Add repeatable table/);
  expect(source).toMatch(/source/);
  expect(source).toMatch(/validateAdvancedTemplateConfig/);
  expect(source).toMatch(/non-blocking publish/);
  expect(source).not.toMatch(/template\.documentType === "invoice"\s*\?/);
});

test("every enabled Paperwork component key loads its matching templates", async () => {
  const source = await readFile("app/(public)/[locale]/paperwork/[slug]/page.tsx", "utf8");

  for (const [componentKey, documentType] of [
    ["invoice-generator", "invoice"],
    ["receipt-generator", "receipt"],
    ["expense-report", "expense-report"],
    ["mileage-log", "mileage-log"],
    ["quarterly-tax-estimator", "quarterly-tax-estimator"],
    ["w9-request", "w9-request"],
    ["1099-nec-tracker", "1099-nec-tracker"],
  ]) {
    expect(source).toMatch(new RegExp(`"${componentKey}"\\s*:\\s*"${documentType}"`));
  }
  expect(source).toMatch(/getPublishedTemplates\(documentType\)/);
});

test("document template publishing validates and renders outside its final transaction", async () => {
  const [mutations, actions, nextConfig] = await Promise.all([
    readFile("lib/admin/adminMutations.ts", "utf8"),
    readFile("app/admin/actions.ts", "utf8"),
    readFile("next.config.ts", "utf8"),
  ]);

  for (const name of [
    "duplicateDocumentTemplate",
    "importDocumentTemplate",
    "updateDocumentTemplate",
    "publishDocumentTemplate",
    "updateAndPublishDocumentTemplate",
    "archiveDocumentTemplate",
    "setDefaultDocumentTemplate",
  ]) {
    expect(mutations).toMatch(new RegExp(`export async function ${name}`));
    expect(actions).toMatch(new RegExp(name));
  }
  expect(mutations).toMatch(/validateAdvancedTemplateForPublish/);
  expect(mutations).toMatch(/import\("@pdfme\/generator"\)/);
  expect(mutations).toMatch(/expectedVersion/);
  expect(mutations).toMatch(/current\.version !== expectedVersion/);
  expect(actions).toMatch(/5_000_000/);
  expect(nextConfig).toMatch(/bodySizeLimit:\s*"6mb"/);
  expect(mutations).toMatch(/eq\(invoiceTemplatesTable\.documentType,\s*template\.documentType\)/);
});
