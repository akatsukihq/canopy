/**
 * SERVER ONLY: this module reads upload credentials and must never be imported
 * by a Client Component. The `server-only` guard package is not installed.
 */

import { cloudinaryCredentials } from "../config/integrations.ts";
import { v2 as cloudinary } from "cloudinary";
import { cloudinaryFolder } from "../cloudinary/paths.ts";
import { mediaRef, type MediaRef } from "../media/index.ts";

const MAX_ICON_BYTES = 1_048_576;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type CloudinaryCredentials = {
  cloud_name: string;
  api_key: string;
  api_secret: string;
};

export type ToolIconUploadResult =
  { ok: true; icon: MediaRef } | { ok: false; reason: string };


function looksLikeSvg(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes).toLowerCase().includes("<svg");
}

function hasExpectedRasterSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  }
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  );
}


export async function uploadToolIcon(
  toolId: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<ToolIconUploadResult> {
  if (bytes.byteLength > MAX_ICON_BYTES) {
    return { ok: false, reason: "The icon must be 1 MB or smaller." };
  }

  const normalizedMimeType = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (normalizedMimeType === "image/svg+xml" || looksLikeSvg(bytes)) {
    return { ok: false, reason: "SVG icons are not supported." };
  }
  if (
    !bytes.byteLength ||
    !ALLOWED_MIME_TYPES.has(normalizedMimeType) ||
    !hasExpectedRasterSignature(bytes, normalizedMimeType)
  ) {
    return { ok: false, reason: "Use a PNG, JPG, or WebP image." };
  }
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(toolId)) {
    return { ok: false, reason: "The tool identifier is invalid." };
  }
  const saved = await cloudinaryCredentials();
  if (!saved) {
    return { ok: false, reason: "Icon uploads are not configured." };
  }
  // Per call, not cloudinary.config(): Admin can rotate the key without a restart.
  const credentials: CloudinaryCredentials = {
    cloud_name: saved.cloudName,
    api_key: saved.apiKey,
    api_secret: saved.apiSecret,
  };

  const folder = cloudinaryFolder("tool-icons");
  try {
    const uploaded = await cloudinary.uploader.upload(
      `data:${normalizedMimeType};base64,${Buffer.from(bytes).toString("base64")}`,
      {
        public_id: `${folder}/${toolId}`,
        asset_folder: folder,
        overwrite: true,
        invalidate: true,
        resource_type: "image",
        allowed_formats: ["png", "jpg", "webp"],
        format: "png",
        transformation: [{ width: 512, height: 512, crop: "limit" }],
        ...credentials,
      },
    );

    if (
      uploaded.public_id !== `${folder}/${toolId}` ||
      !Number.isSafeInteger(uploaded.version) ||
      uploaded.version <= 0 ||
      uploaded.format !== "png"
    ) {
      return { ok: false, reason: "The icon could not be uploaded. Try again." };
    }

    // Validates what Cloudinary returned before it is stored.
    const icon = mediaRef.safeParse({
      v: 1,
      provider: "cloudinary",
      format: "png",
      width: uploaded.width,
      height: uploaded.height,
      bytes: uploaded.bytes,
      uploadedAt: new Date().toISOString(),
      entry: { cloudName: credentials.cloud_name, publicId: uploaded.public_id, version: uploaded.version },
    });
    if (!icon.success) return { ok: false, reason: "The icon could not be uploaded. Try again." };
    return { ok: true, icon: icon.data };
  } catch {
    return { ok: false, reason: "The icon could not be uploaded. Try again." };
  }
}
