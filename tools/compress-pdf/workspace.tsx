"use client";

import { useTranslations } from "next-intl";
import { ToolError } from "@/lib/tool-framework/run";
import { PdfFileWorkspace } from "@/components/PdfFileWorkspace";
import type { WorkspaceProps } from "@/components/ToolWorkspace";
import { parseSettings } from "@/lib/tool-framework/settings";
import { validate } from "./hooks";

export default function CompressPdfWorkspace(props: WorkspaceProps) {
  const t = useTranslations("Tool.runtime");
  return (
    <PdfFileWorkspace
      {...props}
      definitionKey="compress-pdf"
      optionsTitle={t("workspace.options")}
      getPlan={(values, pageCount) => {
        const settings = parseSettings(props.spec.settings, values) as Parameters<typeof validate>[0];
        const issue = validate(settings, []);
        if (issue)
          throw typeof issue === "string"
            ? new Error(issue)
            : new ToolError("confirmation-required", issue.message, undefined, { messageRef: issue.messageRef });
        if (settings.mode === "strong" && (pageCount > 200 || (props.input.files[0]?.size ?? 0) > 52_428_800)) {
          throw new ToolError(
            "strong-compression-limit",
            "Strong Compression supports up to 200 pages and 50 MiB. Use Preserve Document for this PDF.",
            undefined,
            { messageRef: { key: "workspace.strongLimit" } },
          );
        }
        return {
          title: t("workspace.pagesCompressed", { count: pageCount }),
          detail: settings.mode === "strong" ? t("workspace.strongWarning") : t("workspace.preserved"),
        };
      }}
    />
  );
}
