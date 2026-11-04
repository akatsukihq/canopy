"use client";

import { PdfFileWorkspace } from "@/components/PdfFileWorkspace";
import type { WorkspaceProps } from "@/components/ToolWorkspace";
import { parseSettings } from "@/lib/tool-framework/settings";
function getPlan(spec: WorkspaceProps["spec"], values: WorkspaceProps["settings"], pageCount: number) {
  const settings = parseSettings(spec.settings, values);
  if (!/^#[\da-f]{6}$/i.test(String(values.textColor ?? settings.textColor))) {
    throw new Error("Enter a six-digit hex text color, such as #1a1a1a.");
  }
  return {
    title: `${pageCount} ${pageCount === 1 ? "page will" : "pages will"} be numbered`,
    detail: `Numbering starts at ${settings.start}. Your original stays unchanged.`,
  };
}

export default function AddPageNumbersWorkspace(props: WorkspaceProps) {
  return (
    <PdfFileWorkspace
      {...props}
      definitionKey="add-page-numbers"
      optionsTitle="Page number settings"
      getPlan={(values, pageCount) => getPlan(props.spec, values, pageCount)}
    />
  );
}
