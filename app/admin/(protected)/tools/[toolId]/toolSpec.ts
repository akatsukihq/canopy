/**
 * What the tool editor shows each database field falling back to, from the
 * stored definition. Paperwork tools have no spec, and the editor says so.
 */

import type { ToolContent, ToolSpec } from "../../../../../lib/tool-framework/spec";

export type InheritedToolContent = {
  readonly category: string;
  readonly keywords: readonly string[];
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly content: ToolContent | null;
};

/** What the public pages show when the database row overrides nothing. */
export function inheritedContent(spec: ToolSpec | null, name: string, description: string): InheritedToolContent {
  return {
    category: spec?.category ?? "",
    keywords: spec?.keywords ?? [],
    seoTitle: spec?.content.seoTitle ?? name,
    seoDescription: description,
    content: spec?.content ?? null,
  };
}
