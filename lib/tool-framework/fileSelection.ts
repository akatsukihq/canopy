import { getRuntimeLimits } from "./limits.ts";
import type { ToolInputSpec } from "./spec.ts";

export type FileIssueFormatter = (
  key: "fileType" | "fileTooLarge" | "fileLimit" | "fileTotalLimit",
  values: Record<string, string | number>,
) => string;

export interface FileSelectionResult {
  files: readonly File[];
  issue: string;
}

export function acceptsFile(file: File, accept: string): boolean {
  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  return accept.split(",").some((rawPattern) => {
    const pattern = rawPattern.trim().toLowerCase();
    if (!pattern) return false;
    if (pattern === "*/*") return true;
    if (pattern.startsWith(".")) return name.endsWith(pattern);
    if (pattern.endsWith("/*")) return mime.startsWith(pattern.slice(0, -1));
    return mime === pattern;
  });
}

export function textInputFileIssue(
  file: File,
  spec: { readonly accept: string; readonly maxBytes: number },
  formatIssue?: FileIssueFormatter,
): string | null {
  if (!acceptsFile(file, spec.accept)) {
    return formatIssue?.("fileType", { name: file.name }) ?? `${file.name} is not an accepted file type.`;
  }
  const maxBytes = Math.min(spec.maxBytes, getRuntimeLimits().platformMaxBytes);
  if (file.size > maxBytes) {
    return (
      formatIssue?.("fileTooLarge", { name: file.name, maxBytes }) ??
      `${file.name} exceeds the ${maxBytes.toLocaleString()} byte limit.`
    );
  }
  return null;
}

export function validateFileSelection(
  current: readonly File[],
  incoming: readonly File[],
  inputSpec: Extract<ToolInputSpec, { kind: "files" }>,
  formatIssue?: FileIssueFormatter,
): FileSelectionResult {
  const accepted: File[] = [];
  const issues: string[] = [];
  const { platformMaxBytes } = getRuntimeLimits();
  const maxBytes = Math.min(inputSpec.maxBytes ?? platformMaxBytes, platformMaxBytes);
  const maxTotalBytes = Math.min(inputSpec.maxTotalBytes ?? platformMaxBytes, platformMaxBytes);
  for (const file of incoming) {
    if (!acceptsFile(file, inputSpec.accept)) {
      issues.push(formatIssue?.("fileType", { name: file.name }) ?? `${file.name} is not an accepted file type.`);
    } else if (file.size > maxBytes) {
      issues.push(
        formatIssue?.("fileTooLarge", { name: file.name, maxBytes }) ??
          `${file.name} exceeds the ${maxBytes.toLocaleString()} byte limit.`,
      );
    } else {
      accepted.push(file);
    }
  }
  const combined = inputSpec.multiple ? [...current, ...accepted] : accepted.slice(0, 1);
  const limit = inputSpec.maxFiles ?? combined.length;
  if (combined.length > limit) {
    issues.push(
      formatIssue?.("fileLimit", { count: limit }) ?? `Only ${limit} ${limit === 1 ? "file" : "files"} can be added.`,
    );
  }
  const files: File[] = [];
  let totalBytes = 0;
  for (const file of combined.slice(0, limit)) {
    if (file.size > maxTotalBytes - totalBytes) {
      issues.push(
        formatIssue?.("fileTotalLimit", { maxBytes: maxTotalBytes }) ??
          `Selected files must total ${maxTotalBytes.toLocaleString()} bytes or less.`,
      );
      continue;
    }
    files.push(file);
    totalBytes += file.size;
  }
  return { files, issue: [...new Set(issues)].join(" ") };
}
