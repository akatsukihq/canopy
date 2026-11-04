import { z } from "zod";
import type { MediaRef, MediaTransform } from "./index.ts";

export const cloudinaryEntry = z
  .object({
    cloudName: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    publicId: z
      .string()
      .min(1)
      .max(250)
      // Cloudinary forbids these characters; everything else is URL-encoded on delivery.
      // `.`/`..` segments are refused because browsers would resolve them to another asset.
      .regex(/^(?!\.{1,2}(?:\/|$))[^/?#&%\\<>\p{Cc}]+(?:\/(?!\.{1,2}(?:\/|$))[^/?#&%\\<>\p{Cc}]+)*$/u),
    version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

const encodePath = (publicId: string) => publicId.split("/").map(encodeURIComponent).join("/");

/** Cloudinary delivery URL; resizing and format conversion happen in the URL. */
export function cloudinaryUrl(ref: Extract<MediaRef, { provider: "cloudinary" }>, transform: MediaTransform): string {
  const { cloudName, publicId, version } = ref.entry;
  const fixedFormat = transform.format && transform.format !== "auto" ? transform.format : null;
  const resize = [
    transform.width || transform.height ? `c_${transform.fit ?? "limit"}` : null,
    transform.width ? `w_${transform.width}` : null,
    transform.height ? `h_${transform.height}` : null,
  ];
  const steps = fixedFormat
    ? [[`f_${fixedFormat}`, ...resize, "q_auto"].filter(Boolean).join(",")]
    : [resize.filter(Boolean).join(","), ...(transform.format === "auto" ? ["q_auto", "f_auto"] : [])].filter(Boolean);
  return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/image/upload/${steps.map((step) => `${step}/`).join("")}v${version}/${encodePath(publicId)}.${fixedFormat ?? ref.format}`;
}
