"use server";

import { appHref } from "@/lib/routing/subdomains.ts";
import { measureServerAction } from "../../../../lib/observability/sentry.ts";
import { errorMessage } from "../../../../utils/errorMessage.ts";

import { captureException } from "@sentry/core";
import { AuthorizationError } from "@/lib/admin/index.ts";
import { ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActorUserId } from "../../../../lib/admin/access";
import {
  createManagedTool,
  MAX_TOOL_ICON_BYTES,
  removeToolIcon,
  saveToolIcon,
  setToolContentPublished,
  updateToolContent,
  saveToolTranslation,
  ToolTranslationValidationError,
} from "../../../../lib/admin/adminMutations";
import {
  discardToolSpecDraft,
  publishToolSpecDraft,
  saveToolSpecDraft,
  ToolSpecValidationError,
} from "../../../../lib/admin/toolSpecDraft";

export type ToolSpecActionState = {
  status: "idle" | "success" | "error";
  message: string;
  issues?: readonly string[];
  updatedAt?: string;
};

const INVALID_SPEC_JSON = "spec: not valid JSON";

class SpecJsonError extends Error {}

/** Parses the `spec` field; `undefined` when it is absent or blank. */
function specJson(formData: FormData): unknown {
  const raw = text(formData, "spec");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new SpecJsonError("The spec is not valid JSON.");
  }
}

function specFailure(error: unknown): ToolSpecActionState {
  if (error instanceof SpecJsonError) return { status: "error", message: error.message, issues: [INVALID_SPEC_JSON] };
  if (error instanceof ToolSpecValidationError)
    return { status: "error", message: error.message, issues: error.issues };
  return failure(error);
}

async function specDraftAction(
  name: string,
  formData: FormData,
  run: (actorUserId: string, toolId: string, updatedAt: string) => Promise<{ updatedAt: string }>,
  message: string,
): Promise<ToolSpecActionState> {
  return measureServerAction<ToolSpecActionState>(`admin.tools.${name}`, async () => {
    const toolId = text(formData, "toolId");
    try {
      const saved = await run(await getActorUserId(), toolId, text(formData, "updatedAt"));
      revalidate(toolId);
      return { status: "success", message, updatedAt: saved.updatedAt };
    } catch (error) {
      return specFailure(error);
    }
  });
}

export async function saveToolSpecDraftAction(
  _previous: ToolSpecActionState,
  formData: FormData,
): Promise<ToolSpecActionState> {
  return specDraftAction(
    "saveToolSpecDraftAction",
    formData,
    (actor, toolId, updatedAt) => {
      const spec = specJson(formData);
      if (spec === undefined) throw new ToolSpecValidationError(["spec: required"]);
      return saveToolSpecDraft(actor, toolId, { spec, updatedAt });
    },
    "Spec draft saved.",
  );
}

export async function publishToolSpecDraftAction(
  _previous: ToolSpecActionState,
  formData: FormData,
): Promise<ToolSpecActionState> {
  return specDraftAction(
    "publishToolSpecDraftAction",
    formData,
    async (actor, toolId, updatedAt) => {
      const saved = await publishToolSpecDraft(actor, toolId, { updatedAt });
      revalidatePath("/", "layout");
      return saved;
    },
    "Spec published.",
  );
}

export async function discardToolSpecDraftAction(
  _previous: ToolSpecActionState,
  formData: FormData,
): Promise<ToolSpecActionState> {
  return specDraftAction(
    "discardToolSpecDraftAction",
    formData,
    (actor, toolId, updatedAt) => discardToolSpecDraft(actor, toolId, { updatedAt }),
    "Spec draft discarded.",
  );
}

export type ToolTranslationActionState = ToolContentActionState & {
  readonly issues?: readonly { key: string; message: string }[];
  readonly updatedAt?: string;
  readonly translationStatus?: "draft" | "published";
  readonly sourceChanged?: boolean;
};

export async function saveToolTranslationAction(
  _previous: ToolTranslationActionState,
  formData: FormData,
): Promise<ToolTranslationActionState> {
  return measureServerAction<ToolTranslationActionState>("admin.tools.saveToolTranslationAction", async () => {
    const toolId = text(formData, "toolId");
    try {
      const messages: Record<string, string> = Object.create(null);
      for (const [key, value] of formData.entries()) {
        if (key.startsWith("message:")) {
          if (typeof value !== "string") throw new Error("Translation messages must be text.");
          messages[key.slice("message:".length)] = value;
        }
      }
      const status = text(formData, "status");
      if (status !== "draft" && status !== "published") throw new Error("Choose draft or publish.");
      const saved = await saveToolTranslation(await getActorUserId(), toolId, {
        locale: text(formData, "locale"),
        status,
        messages,
        updatedAt: text(formData, "updatedAt"),
      });
      revalidate(toolId);
      revalidatePath("/", "layout");
      return {
        status: "success",
        message: status === "published" ? "Translation published." : "Translation draft saved.",
        updatedAt: saved.updatedAt,
        translationStatus: saved.status,
        sourceChanged: saved.sourceChanged,
      };
    } catch (error) {
      if (error instanceof ToolTranslationValidationError) {
        return { status: "error", message: error.message, issues: error.issues };
      }
      return failure(error);
    }
  });
}

export type ToolContentActionState = {
  readonly status: "idle" | "success" | "error";
  readonly message: string;
};

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** One entry per line; blank lines are dropped, so a blank box means "none". */
function lines(formData: FormData, key: string): string[] {
  return text(formData, key)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function keywords(formData: FormData, key: string): string[] {
  return text(formData, key)
    .split(/[\n,]/)
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);
}

function jsonList(formData: FormData, key: string, label: string): unknown[] {
  const raw = text(formData, key);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`);
  return parsed;
}

function failure(error: unknown): ToolContentActionState {
  if (!(error instanceof AuthorizationError || error instanceof ZodError)) captureException(error);
  return {
    status: "error",
    message: errorMessage(error, "The change could not be saved."),
  };
}

function revalidate(toolId: string): void {
  revalidatePath("/admin/tools");
  revalidatePath(`/admin/tools/${encodeURIComponent(toolId)}`);
}

/**
 * Creates the database half of a tool — the `managed_tools` row and its empty
 * `tool_content` row — before `tools/<key>/` exists. `redirect` throws the
 * Next.js control-flow error, so it runs outside the try/catch that turns real
 * failures into a form message.
 */
export async function createToolAction(
  _previous: ToolSpecActionState,
  formData: FormData,
): Promise<ToolSpecActionState> {
  return measureServerAction<ToolSpecActionState>("admin.tools.createToolAction", async () => {
    let toolId: string;
    try {
      const created = await createManagedTool(await getActorUserId(), {
        app: text(formData, "app"),
        key: text(formData, "key"),
        name: text(formData, "name"),
        description: text(formData, "description"),
        slug: text(formData, "slug"),
        category: text(formData, "category"),
        spec: specJson(formData),
      });
      toolId = created.toolId;
    } catch (error) {
      return specFailure(error);
    }
    revalidatePath("/admin/tools");
    redirect(appHref(`/admin/tools/${encodeURIComponent(toolId)}`));
  });
}

export async function saveToolContentAction(
  _previous: ToolContentActionState,
  formData: FormData,
): Promise<ToolContentActionState> {
  return measureServerAction<ToolContentActionState>("admin.tools.saveToolContentAction", async () => {
    const toolId = text(formData, "toolId");
    try {
      // "inherit" clears the whole document, which is how the resolver reads it:
      // a stored document replaces the shipped one wholesale or not at all.
      const overrideDoc = text(formData, "contentDocMode") === "override";
      await updateToolContent(await getActorUserId(), toolId, {
        category: text(formData, "category"),
        keywords: keywords(formData, "keywords"),
        seoTitle: text(formData, "seoTitle"),
        seoDescription: text(formData, "seoDescription"),
        contentDoc: overrideDoc
          ? {
              howToUse: lines(formData, "howToUse"),
              limitations: lines(formData, "limitations"),
              faq: jsonList(formData, "faq", "FAQ"),
              examples: jsonList(formData, "examples", "Examples"),
              relatedToolIds: lines(formData, "relatedToolIds"),
            }
          : null,
      });
      revalidate(toolId);
      return { status: "success", message: "Content saved." };
    } catch (error) {
      return failure(error);
    }
  });
}

export async function publishToolContentAction(
  _previous: ToolContentActionState,
  formData: FormData,
): Promise<ToolContentActionState> {
  return measureServerAction<ToolContentActionState>("admin.tools.publishToolContentAction", async () => {
    const toolId = text(formData, "toolId");
    const published = text(formData, "published") === "true";
    try {
      await setToolContentPublished(await getActorUserId(), toolId, published);
      revalidate(toolId);
      return {
        status: "success",
        message: published ? "Stored content is live." : "Stored content is back to draft; the code values are live.",
      };
    } catch (error) {
      return failure(error);
    }
  });
}

export async function uploadToolIconAction(
  _previous: ToolContentActionState,
  formData: FormData,
): Promise<ToolContentActionState> {
  return measureServerAction<ToolContentActionState>("admin.tools.uploadToolIconAction", async () => {
    const toolId = text(formData, "toolId");
    try {
      const file = formData.get("icon");
      if (!(file instanceof File) || file.size === 0) {
        throw new Error("Choose a PNG, JPG, or WebP image.");
      }
      // Size is rejected before the file is ever read into memory.
      if (file.size > MAX_TOOL_ICON_BYTES) {
        throw new Error("The icon must be 1 MB or smaller.");
      }
      await saveToolIcon(await getActorUserId(), toolId, {
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type,
      });
      revalidate(toolId);
      return { status: "success", message: "Icon uploaded." };
    } catch (error) {
      return failure(error);
    }
  });
}

export async function removeToolIconAction(
  _previous: ToolContentActionState,
  formData: FormData,
): Promise<ToolContentActionState> {
  return measureServerAction<ToolContentActionState>("admin.tools.removeToolIconAction", async () => {
    const toolId = text(formData, "toolId");
    try {
      await removeToolIcon(await getActorUserId(), toolId);
      revalidate(toolId);
      return {
        status: "success",
        message: "Icon removed; the tool falls back to its generated identicon.",
      };
    } catch (error) {
      return failure(error);
    }
  });
}
