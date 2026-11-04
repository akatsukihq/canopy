"use server";

import { measureServerAction } from "../../../../lib/observability/sentry.ts";
import { captureException, getActiveSpan } from "@sentry/core";
import { z, ZodError } from "zod";
import { errorMessage } from "../../../../utils/errorMessage.ts";
import { AuthorizationError } from "@/lib/admin/index.ts";
import { getActorUserId } from "../../../../lib/admin/access";
import {
  BlogError,
  createBlogPost,
  duplicateBlogPost,
  saveBlogDraft,
  publishBlogPost,
  scheduleBlogPost,
  retryBlogSchedule,
  cancelBlogSchedule,
  unpublishBlogPost,
  trashBlogPost,
  restoreTrashedBlogPost,
  restoreBlogRevision,
  saveBlogTerm,
} from "../../../../lib/blog/mutations";
import { BlogValidationError, renderBlogDocument } from "../../../../lib/blog/document";
import { BlogImageUploadError, prepareBlogImageUpload, completeBlogImageUpload } from "../../../../lib/blog/images";
import {
  getBlogPost,
  getBlogRevision,
  listBlogPosts,
  listBlogRevisions,
  listBlogTaxonomy,
} from "../../../../lib/blog/queries";

const operations = {
  create: createBlogPost,
  duplicate: duplicateBlogPost,
  save: saveBlogDraft,
  publish: publishBlogPost,
  schedule: scheduleBlogPost,
  retrySchedule: retryBlogSchedule,
  cancelSchedule: cancelBlogSchedule,
  unpublish: unpublishBlogPost,
  trash: trashBlogPost,
  restoreTrash: restoreTrashedBlogPost,
  restoreRevision: restoreBlogRevision,
  saveTerm: saveBlogTerm,
};

function failure(error: unknown) {
  if (error instanceof BlogError) return { ok: false as const, code: error.code, message: error.message };
  if (error instanceof BlogValidationError || error instanceof ZodError) {
    return {
      ok: false as const,
      code: "VALIDATION" as const,
      message: errorMessage(error, "Check the supplied fields and try again."),
    };
  }
  if (error instanceof AuthorizationError)
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
      message: "You do not have permission to perform this action.",
    };
  captureException(error);
  return {
    ok: false as const,
    code: "TEMPORARY_FAILURE" as const,
    message: errorMessage(error, "The change could not be saved. Try again."),
  };
}

/** The session owns identity. Mutation schemas reject actor IDs, slugs and extra fields. */
export async function mutateBlogAction(operation: keyof typeof operations, input: unknown) {
  return measureServerAction("admin.blog.mutateBlogAction", async () => {
    const actor = await getActorUserId();
    try {
      if (!Object.hasOwn(operations, operation)) throw new BlogError("VALIDATION", "Unknown blog operation.");
      getActiveSpan()?.setAttribute("app.operation", operation);
      return { ok: true as const, data: await operations[operation](actor, input) };
    } catch (error) {
      return failure(error);
    }
  });
}

function imageUploadFailure(error: unknown) {
  if (error instanceof BlogImageUploadError) return { ok: false as const, code: error.code, message: error.message };
  const result = failure(error);
  return result.code === "TEMPORARY_FAILURE"
    ? {
        ok: false as const,
        code: "UPLOAD_TEMPORARY_FAILURE" as const,
        message: errorMessage(error, "The image upload failed unexpectedly. Try uploading the image again."),
      }
    : result;
}

export async function prepareBlogImageUploadAction(input: unknown) {
  return measureServerAction("admin.blog.prepareBlogImageUploadAction", async () => {
    const actor = await getActorUserId();
    try {
      return { ok: true as const, data: await prepareBlogImageUpload(actor, input) };
    } catch (error) {
      return imageUploadFailure(error);
    }
  });
}

export async function completeBlogImageUploadAction(input: unknown) {
  return measureServerAction("admin.blog.completeBlogImageUploadAction", async () => {
    const actor = await getActorUserId();
    try {
      return { ok: true as const, data: await completeBlogImageUpload(actor, input) };
    } catch (error) {
      return imageUploadFailure(error);
    }
  });
}

const readInput = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("list"), filters: z.unknown().optional() }).strict(),
  z.object({ operation: z.literal("post"), postId: z.string() }).strict(),
  z
    .object({
      operation: z.literal("history"),
      postId: z.string(),
      cursor: z.string().optional(),
      page: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("preview"),
      postId: z.string(),
      revisionId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("taxonomy"),
      kind: z.enum(["category", "tag"]),
      filters: z.unknown().optional(),
    })
    .strict(),
]);

/** Server Actions use authenticated POST responses; no preview is placed in a public cache. */
export async function readBlogAction(input: unknown) {
  return measureServerAction("admin.blog.readBlogAction", async () => {
    const actor = await getActorUserId();
    try {
      const value = readInput.parse(input);
      getActiveSpan()?.setAttribute("app.operation", value.operation);
      switch (value.operation) {
        case "list":
          return { ok: true as const, data: await listBlogPosts(actor, value.filters) };
        case "history":
          return {
            ok: true as const,
            data: await listBlogRevisions(actor, value.postId, value.cursor, value.page),
          };
        case "taxonomy":
          return {
            ok: true as const,
            data: await listBlogTaxonomy(actor, value.kind, value.filters),
          };
        case "post": {
          const data = await getBlogPost(actor, value.postId);
          if (!data) throw new BlogError("NOT_FOUND", "Article not found.");
          return { ok: true as const, data };
        }
        case "preview": {
          const source = value.revisionId
            ? await getBlogRevision(actor, value.postId, value.revisionId)
            : await getBlogPost(actor, value.postId);
          if (!source) throw new BlogError("NOT_FOUND", "Article or revision not found.");
          const document = "document" in source ? source.document : source.draftDocument;
          return {
            ok: true as const,
            data: {
              document,
              ...renderBlogDocument(document),
              robots: "noindex, nofollow",
            },
          };
        }
      }
    } catch (error) {
      return failure(error);
    }
  });
}
