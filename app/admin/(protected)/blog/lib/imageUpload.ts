import { captureException } from "@sentry/nextjs";
import { z } from "zod";
import type { BlogImage } from "@/lib/blog/document";
import { mediaUrl, type MediaRef } from "@/lib/media";
import { completeBlogImageUploadAction, prepareBlogImageUploadAction } from "../actions.ts";

type UploadResult = { ok: true; data: BlogImage } | { ok: false; message: string };

const uploadedImageSchema = z.object({
  public_id: z.string(),
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  format: z.enum(["jpg", "jpeg", "png", "webp"]),
  width: z.number().int().min(1).max(30000),
  height: z.number().int().min(1).max(30000),
  bytes: z
    .number()
    .int()
    .min(1)
    .max(5 * 1024 * 1024),
  resource_type: z.literal("image"),
  type: z.literal("upload"),
  secure_url: z.string(),
});

function hasMatchingImageHeader(file: File, bytes: Uint8Array): boolean {
  const readText = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

  switch (file.type) {
    case "image/png": {
      if (bytes.length < 24) return false;
      const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      const hasPngSignature = pngSignature.every((byte, index) => bytes[index] === byte);
      const hasImageHeaderChunk = readText(12, 16) === "IHDR";
      return hasPngSignature && hasImageHeaderChunk;
    }
    case "image/jpeg": {
      if (bytes.length < 4) return false;
      const hasStartOfImage = bytes[0] === 0xff && bytes[1] === 0xd8;
      const hasMarkerPrefix = bytes[2] === 0xff;
      return hasStartOfImage && hasMarkerPrefix;
    }
    case "image/webp": {
      if (bytes.length < 20) return false;
      const hasWebpContainer = readText(0, 4) === "RIFF" && readText(8, 12) === "WEBP";
      const hasSupportedImageChunk = ["VP8 ", "VP8L", "VP8X"].includes(readText(12, 16));
      // RIFF stores the file size minus its first eight bytes, in little-endian order.
      const declaredFileSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8;
      return hasWebpContainer && hasSupportedImageChunk && declaredFileSize === file.size;
    }
    default:
      return false;
  }
}

export async function uploadBlogImageDirect(file: File): Promise<UploadResult> {
  const failed = (message: string): UploadResult => ({ ok: false, message });
  if (!(file instanceof File) || !["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return failed("Choose a JPEG, PNG or WebP image.");
  if (!file.size || file.size > 5 * 1024 * 1024) return failed("Images must be nonempty and no larger than 5 MiB.");

  const controller = new AbortController();
  const timeout = failed("Image upload timed out. Check your connection and try uploading again.");
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<UploadResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(timeout);
    }, 120_000);
  });
  const checkActive = () => controller.signal.throwIfAborted();
  const upload = async (): Promise<UploadResult> => {
    try {
      const bytes = new Uint8Array(await file.slice(0, 24).arrayBuffer());
      checkActive();
      if (!hasMatchingImageHeader(file, bytes))
        return failed("Image content does not match its JPEG, PNG or WebP file type.");

      const prepared = await prepareBlogImageUploadAction({ name: file.name, size: file.size, type: file.type });
      checkActive();
      if (!prepared.ok) return failed(prepared.message);
      const { uploadUrl, fields, completion } = prepared.data;
      if (
        !/^https:\/\/api\.cloudinary\.com\/v1_1\/[a-zA-Z0-9_-]+\/image\/upload$/.test(uploadUrl) ||
        uploadUrl !== `https://api.cloudinary.com/v1_1/${completion.cloudName}/image/upload` ||
        !fields ||
        Object.values(fields).some((value) => typeof value !== "string") ||
        "file" in fields
      )
        return failed("Image upload could not be prepared. Try uploading again.");
      const body = new FormData();
      for (const [name, value] of Object.entries(fields)) body.append(name, value);
      body.append("file", file);
      const response = await fetch(uploadUrl, {
        method: "POST",
        body,
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      });
      checkActive();
      if (!response.ok) {
        if (response.status === 429) return failed("Image uploads are busy. Wait a moment and try uploading again.");
        if (response.status >= 400 && response.status < 500)
          return failed(
            "The image upload was rejected. Try uploading again; if it continues, contact an administrator.",
          );
        return failed("Image uploads are temporarily unavailable. Try uploading again.");
      }
      const uploaded: unknown = await response.json();
      checkActive();
      const parsed = uploadedImageSchema.safeParse(uploaded);
      if (!parsed.success || parsed.data.public_id !== completion.publicId)
        return failed("The image service returned an incomplete response. Try uploading again.");
      const { public_id, version, format, width, height, secure_url } = parsed.data;
      const media: MediaRef = {
        v: 1,
        provider: "cloudinary",
        format,
        width,
        height,
        bytes: file.size,
        uploadedAt: new Date().toISOString(),
        entry: { cloudName: completion.cloudName, publicId: public_id, version },
      };
      if (secure_url !== mediaUrl(media))
        return failed("The image service returned an incomplete response. Try uploading again.");
      const image: BlogImage = {
        media,
        alt: completion.name
          .replace(/\.[^.]*$/u, "")
          .replace(/[-_\s\u0000-\u001f\u007f]+/gu, " ")
          .trim()
          .slice(0, 500)
          .replace(/[\uD800-\uDBFF]$/u, ""),
        caption: "",
      };
      // Recording the upload must not delay displaying an image already stored successfully.
      void (async () => {
        try {
          const completed = await completeBlogImageUploadAction({ ...completion, uploaded: parsed.data });
          if (!completed.ok) throw new Error("Image upload completion failed.");
        } catch {
          captureException(new Error("Blog image upload completion failed."));
        }
      })();
      return { ok: true, data: image };
    } catch {
      return controller.signal.aborted
        ? timeout
        : failed("Image upload failed. Check your connection and try uploading again.");
    }
  };
  try {
    return await Promise.race([upload(), deadline]);
  } finally {
    clearTimeout(timer!);
  }
}
