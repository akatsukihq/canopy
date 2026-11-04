import { renderIdenticon } from "./identicon.ts";
import { TOOL_ICON_KEYS } from "./toolIconKeys.generated.ts";

const FOLDER_ICON_KEYS = new Set(TOOL_ICON_KEYS);

export type ResolvedIcon = { kind: "url"; url: string } | { kind: "svg"; svg: string };

export function toolIconUrl(cloud: string, row: { publicId: string; version: string }): string {
  const publicId = row.publicId
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `https://res.cloudinary.com/${encodeURIComponent(cloud)}/image/upload/f_png,c_fill,w_256,h_256,q_auto/v${encodeURIComponent(row.version)}/${publicId}.png`;
}

export function toolFaviconHref(icon: ResolvedIcon): string {
  if (icon.kind === "svg") return `data:image/svg+xml,${encodeURIComponent(icon.svg)}`;
  // Folder icons are same-origin static files already.
  if (icon.url.startsWith("/")) return icon.url;
  // Keep the version and asset path; Chromium favicons cannot use CORS under media's COEP.
  const assetPath = new URL(icon.url).pathname.split("/").slice(5).join("/");
  return `/tool-icons/${assetPath}`;
}

export function resolveIcon(toolId: string, name: string, iconUrl: string | null): ResolvedIcon {
  if (iconUrl) return { kind: "url", url: iconUrl };
  // Folder icon: tools/<key>/icon.svg, copied to public/tool-icons/<key>.svg by scripts/copy-tool-icons.mjs.
  const key = toolId.split(".")[1] ?? "";
  if (FOLDER_ICON_KEYS.has(key)) return { kind: "url", url: `/tool-icons/${key}.svg` };
  return { kind: "svg", svg: renderIdenticon(toolId, name) };
}
