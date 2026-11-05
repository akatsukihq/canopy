import { expect, test } from "vitest";
import { resolveIcon, toolFaviconHref } from "@/lib/tool-framework/icons.ts";
import { TOOL_ICON_KEYS } from "@/lib/tool-framework/toolIconKeys.generated.ts";

const key = TOOL_ICON_KEYS[0];

const media = { v: 1, provider: "cloudinary", format: "png", width: 256, height: 256, uploadedAt: "2026-01-01T00:00:00Z", entry: { cloudName: "c", publicId: "a/b/x", version: 1 } };

test("an uploaded icon wins over the folder icon and invalid stored icons fall back", () => {
  expect(resolveIcon(`media.${key}`, "X", media)).toEqual({ kind: "url", url: "https://res.cloudinary.com/c/image/upload/f_png,c_fill,w_256,h_256,q_auto/v1/a/b/x.png", media });
  for (const bad of ["https://example.test/x.png", { ...media, provider: "s3" }, { ...media, entry: {} }]) {
    expect(resolveIcon(`media.${key}`, "X", bad)).toEqual({ kind: "url", url: `/tool-icons/${key}.svg` });
  }
});

test("a tool with a folder icon resolves to its static file", () => {
  const icon = resolveIcon(`media.${key}`, "X", null);
  expect(icon).toEqual({ kind: "url", url: `/tool-icons/${key}.svg` });
  expect(toolFaviconHref(icon)).toBe(`/tool-icons/${key}.svg`);
});

test("a tool without a folder icon falls back to the identicon", () => {
  const icon = resolveIcon("media.no-such-tool", "X", null);
  expect(icon.kind).toBe("svg");
  expect(toolFaviconHref(icon)).toMatch(/^data:image\/svg\+xml,/);
});

test("every manifest key has a copied file", async () => {
  const { existsSync } = await import("node:fs");
  for (const k of TOOL_ICON_KEYS) expect(existsSync(`public/tool-icons/${k}.svg`)).toBe(true);
});
