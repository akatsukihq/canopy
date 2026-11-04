import { expect, test } from "vitest";
import { resolveIcon, toolFaviconHref } from "@/lib/tool-framework/icons.ts";
import { TOOL_ICON_KEYS } from "@/lib/tool-framework/toolIconKeys.generated.ts";

const key = TOOL_ICON_KEYS[0];

test("admin-uploaded iconUrl wins over the folder icon", () => {
  const url = "https://res.cloudinary.com/c/image/upload/v1/a/b/x.png";
  expect(resolveIcon(`media.${key}`, "X", url)).toEqual({ kind: "url", url });
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
