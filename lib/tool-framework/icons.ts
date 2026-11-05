import { mediaRef, mediaUrl, type MediaRef } from "../media/index.ts";
import { renderIdenticon } from "./identicon.ts";
import { TOOL_ICON_KEYS } from "./toolIconKeys.generated.ts";

const FOLDER_ICON_KEYS = new Set(TOOL_ICON_KEYS);

export type ResolvedIcon = { kind: "url"; url: string; media?: MediaRef } | { kind: "svg"; svg: string };

/** Every tool icon is delivered as a 256px square PNG. */
export const toolIconUrl = (media: MediaRef): string =>
  mediaUrl(media, { width: 256, height: 256, fit: "fill", format: "png" });

export function toolFaviconHref(icon: ResolvedIcon): string {
  if (icon.kind === "svg") return `data:image/svg+xml,${encodeURIComponent(icon.svg)}`;
  // Folder icons are same-origin static files already.
  if (!icon.media) return icon.url;
  // Same-origin proxy: Chromium favicons cannot use CORS under media's COEP.
  const { cloudName, publicId, version } = icon.media.entry;
  return `/tool-icons/${encodeURIComponent(cloudName)}/v${version}/${publicId.split("/").map(encodeURIComponent).join("/")}.png`;
}

/** `stored` is the untrusted `icon` column; anything that is not a valid MediaRef falls back. */
export function resolveIcon(toolId: string, name: string, stored: unknown): ResolvedIcon {
  const parsed = mediaRef.safeParse(stored);
  if (parsed.success) return { kind: "url", url: toolIconUrl(parsed.data), media: parsed.data };
  // Folder icon: tools/<key>/icon.svg, copied to public/tool-icons/<key>.svg by scripts/copy-tool-icons.mjs.
  const key = toolId.split(".")[1] ?? "";
  if (FOLDER_ICON_KEYS.has(key)) return { kind: "url", url: `/tool-icons/${key}.svg` };
  return { kind: "svg", svg: renderIdenticon(toolId, name) };
}
