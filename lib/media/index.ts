import { z } from "zod";
import { cloudinaryEntry, cloudinaryUrl } from "./cloudinary.ts";

/**
 * A stored file reference. Every record carries its own provider and account, so
 * switching the active upload provider never changes how existing files resolve.
 * Add a provider: one file next to `cloudinary.ts`, then a branch in `mediaRef`
 * and `mediaUrl`.
 */
export const MEDIA_FORMATS = ["png", "jpg", "jpeg", "webp"] as const;
export type MediaFormat = (typeof MEDIA_FORMATS)[number];

const common = {
  v: z.literal(1),
  format: z.enum(MEDIA_FORMATS),
  width: z.number().int().min(1).max(30_000),
  height: z.number().int().min(1).max(30_000),
  bytes: z.number().int().min(1).optional(),
  uploadedAt: z.iso.datetime(),
};

export const mediaRef = z.discriminatedUnion("provider", [
  z.object({ ...common, provider: z.literal("cloudinary"), entry: cloudinaryEntry }).strict(),
]);
export type MediaRef = z.infer<typeof mediaRef>;
export type MediaProvider = MediaRef["provider"];

export type MediaTransform = {
  width?: number;
  height?: number;
  /** `limit` keeps the aspect ratio inside the box; `fill` crops to it. */
  fit?: "limit" | "fill";
  /** `auto` lets the provider pick the best format for the browser. */
  format?: "auto" | MediaFormat;
};

/** The public URL of `ref`, resized when the provider supports it. */
export function mediaUrl(ref: MediaRef, transform: MediaTransform = {}): string {
  switch (ref.provider) {
    case "cloudinary":
      return cloudinaryUrl(ref, transform);
  }
}

/** Widths for `srcset`, capped at the original and 2560px. */
export function responsiveMedia(ref: MediaRef, defaultWidth = 1280): { src: string; srcSet: string } {
  const maxWidth = Math.min(ref.width, 2560);
  const widths = [320, 640, 960, 1280, 1920, 2560].filter((width) => width < maxWidth);
  widths.push(maxWidth);
  const at = (width: number) => mediaUrl(ref, { width, fit: "limit", format: "auto" });
  return {
    src: at(Math.min(ref.width, defaultWidth)),
    srcSet: widths.map((width) => `${at(width)} ${width}w`).join(", "),
  };
}

/** Where the file lives, for grouping and usage counts: `cloudinary:<cloud>`. */
export function mediaAccount(ref: MediaRef): string {
  switch (ref.provider) {
    case "cloudinary":
      return `cloudinary:${ref.entry.cloudName}`;
  }
}
