/** Server-only: upload credentials and authorization must never reach clients. */
import { cloudinaryCredentials } from "../config/integrations.ts";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { db } from "../../db/index.ts";
import { AuthorizationError } from "../admin/index.ts";
import { cloudinaryFolder } from "../cloudinary/paths.ts";
import { requireTransactionPermission, writeAudit } from "../admin/adminMutations.ts";
import { BlogValidationError, validateBlogImage, type BlogImage } from "./document.ts";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const UPLOAD_LIFETIME_SECONDS = 600;

export interface BlogImageUploadCompletion {
  cloudName: string;
  publicId: string;
  timestamp: number;
  name: string;
  size: number;
  type: string;
  token: string;
}
export interface PreparedBlogImageUpload {
  uploadUrl: string;
  fields: Record<string, string>;
  completion: BlogImageUploadCompletion;
}

/** Only messages authored here are safe to return to the upload UI. */
export class BlogImageUploadError extends Error {
  readonly code:
    | "UPLOAD_NOT_CONFIGURED"
    | "UPLOAD_REJECTED"
    | "UPLOAD_TEMPORARY_FAILURE"
    | "UPLOAD_INVALID_RESPONSE"
    | "UPLOAD_FINALIZATION_FAILED";
  constructor(code: BlogImageUploadError["code"], message: string) {
    super(message);
    this.name = "BlogImageUploadError";
    this.code = code;
  }
}

function uploadInput(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).some((key) => typeof key !== "string" || !allowed.includes(key))
  )
    throw new BlogValidationError("Image upload details are invalid. Choose the image again.");
  return input as Record<string, unknown>;
}

function imageMetadata(input: Record<string, unknown>) {
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 4096 || !input.name.isWellFormed())
    throw new BlogValidationError("Image filename is invalid.");
  if (
    typeof input.size !== "number" ||
    !Number.isSafeInteger(input.size) ||
    input.size < 1 ||
    input.size > MAX_IMAGE_BYTES
  )
    throw new BlogValidationError("Images must be nonempty and no larger than 5 MiB.");
  if (typeof input.type !== "string" || !["image/jpeg", "image/png", "image/webp"].includes(input.type))
    throw new BlogValidationError("Use a JPEG, PNG or WebP image.");
  return { name: input.name, size: input.size, type: input.type };
}

async function credentials() {
  const saved = await cloudinaryCredentials();
  const { cloudName, apiKey, apiSecret } = saved ?? { cloudName: "", apiKey: "", apiSecret: "" };
  if (!cloudName || !/^[a-zA-Z0-9_-]+$/.test(cloudName) || !apiKey || !apiSecret)
    throw new BlogImageUploadError(
      "UPLOAD_NOT_CONFIGURED",
      "Image uploads are not configured. Ask an administrator to configure the Cloudinary cloud name, API key and API secret on the server.",
    );
  return { cloudName, apiKey, apiSecret };
}

function completionToken(actor: string, input: Omit<BlogImageUploadCompletion, "token">, secret: string): string {
  return createHmac("sha256", secret)
    .update(
      JSON.stringify([
        "blog-image-upload",
        actor,
        input.cloudName,
        input.publicId,
        input.timestamp,
        input.name,
        input.size,
        input.type,
      ]),
    )
    .digest("hex");
}

async function authorizeUpload(actorUserId: string) {
  try {
    await db.transaction((transaction) => requireTransactionPermission(transaction, actorUserId, "blog", "edit"));
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    throw new BlogImageUploadError(
      "UPLOAD_TEMPORARY_FAILURE",
      "Image upload access could not be checked. Try uploading again.",
    );
  }
}

export async function prepareBlogImageUpload(actorUserId: string, input: unknown): Promise<PreparedBlogImageUpload> {
  await authorizeUpload(actorUserId);
  const metadata = imageMetadata(uploadInput(input, ["name", "size", "type"]));
  const { cloudName, apiKey, apiSecret } = await credentials();
  const folder = cloudinaryFolder("blog");
  const publicId = `${folder}/${randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const fields = {
    timestamp: String(timestamp),
    public_id: publicId,
    asset_folder: folder,
    type: "upload",
    overwrite: "false",
    allowed_formats: "jpg,jpeg,png,webp",
  };
  const completion = { cloudName, publicId, timestamp, ...metadata };
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    fields: { ...fields, api_key: apiKey, signature: cloudinary.utils.api_sign_request(fields, apiSecret) },
    completion: { ...completion, token: completionToken(actorUserId, completion, apiSecret) },
  };
}

export async function completeBlogImageUpload(actorUserId: string, input: unknown): Promise<BlogImage> {
  const value = uploadInput(input, ["cloudName", "publicId", "timestamp", "name", "size", "type", "token", "uploaded"]);
  const metadata = imageMetadata(value);
  const { cloudName, apiSecret } = await credentials();
  const folder = cloudinaryFolder("blog");
  const now = Math.floor(Date.now() / 1000);
  if (
    value.cloudName !== cloudName ||
    typeof value.publicId !== "string" ||
    !value.publicId.startsWith(`${folder}/`) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value.publicId.slice(folder.length + 1),
    ) ||
    typeof value.timestamp !== "number" ||
    !Number.isSafeInteger(value.timestamp) ||
    value.timestamp > now ||
    now - value.timestamp > UPLOAD_LIFETIME_SECONDS ||
    typeof value.token !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.token)
  )
    throw new BlogValidationError("Image upload authorization is invalid or expired. Choose the image again.");
  // The signed cloud must be the one these credentials upload to, so a client cannot swap accounts.
  const completion = { cloudName, publicId: value.publicId, timestamp: value.timestamp, ...metadata };
  const expected = completionToken(actorUserId, completion, apiSecret);
  if (!timingSafeEqual(Buffer.from(value.token, "hex"), Buffer.from(expected, "hex")))
    throw new BlogValidationError("Image upload authorization is invalid. Choose the image again.");
  const publicId = completion.publicId;
  let image: BlogImage;
  try {
    const uploaded = uploadInput(value.uploaded, [
      "public_id",
      "version",
      "format",
      "width",
      "height",
      "bytes",
      "resource_type",
      "type",
      "secure_url",
    ]);
    if (
      uploaded.public_id !== publicId ||
      uploaded.resource_type !== "image" ||
      uploaded.type !== "upload" ||
      typeof uploaded.secure_url !== "string"
    )
      throw new Error("Unexpected upload response.");
    if (
      typeof uploaded.bytes !== "number" ||
      !Number.isSafeInteger(uploaded.bytes) ||
      uploaded.bytes < 1 ||
      uploaded.bytes > MAX_IMAGE_BYTES
    )
      throw new BlogImageUploadError(
        "UPLOAD_REJECTED",
        "Images must be nonempty and no larger than 5 MiB. Choose a smaller image and upload it again.",
      );
    image = validateBlogImage({
      media: {
        v: 1,
        provider: "cloudinary",
        format: uploaded.format,
        width: uploaded.width,
        height: uploaded.height,
        bytes: completion.size,
        uploadedAt: new Date().toISOString(),
        entry: { cloudName, publicId: uploaded.public_id, version: uploaded.version },
      },
      alt: completion.name
        .replace(/\.[^.]*$/u, "")
        .replace(/[-_\s\u0000-\u001f\u007f]+/gu, " ")
        .trim()
        .slice(0, 500)
        .replace(/[\uD800-\uDBFF]$/u, ""),
      caption: "",
      src: uploaded.secure_url,
    });
  } catch (error) {
    if (error instanceof BlogImageUploadError) throw error;
    throw new BlogImageUploadError(
      "UPLOAD_INVALID_RESPONSE",
      "Image storage returned an invalid upload result. Retry the upload; if it continues, ask an administrator to check image storage.",
    );
  }
  try {
    return await db.transaction(async (transaction) => {
      await requireTransactionPermission(transaction, actorUserId, "blog", "edit");
      const { entry, format, width, height } = image.media;
      await writeAudit(transaction, actorUserId, "blog.image.upload", "blog-image", entry.publicId, {
        cloudName: entry.cloudName,
        publicId: entry.publicId,
        version: entry.version,
        format,
        width,
        height,
      });
      return image;
    });
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    throw new BlogImageUploadError(
      "UPLOAD_FINALIZATION_FAILED",
      "The image reached storage but could not be recorded. Wait a moment, then retry the image upload.",
    );
  }
}
