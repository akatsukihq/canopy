"use server";

import { captureException } from "@sentry/core";
import { revalidatePath } from "next/cache";
import { getActorUserId } from "@/lib/admin/access";
import { AuthorizationError } from "@/lib/admin/index.ts";
import { SystemLimitValueError, updateSystemLimit } from "@/lib/admin/systemLimits.ts";
import { measureServerAction } from "@/lib/observability/sentry.ts";
import { errorMessage } from "@/utils/errorMessage.ts";

export type SystemLimitActionState = {
  status: "idle" | "success" | "error";
  message: string;
  /** Set when the value itself was rejected, so the form shows it beside the field. */
  fieldError?: string;
  updatedAt?: string;
};

export async function updateSystemLimitAction(
  _previous: SystemLimitActionState,
  formData: FormData,
): Promise<SystemLimitActionState> {
  return measureServerAction<SystemLimitActionState>("admin.settings.updateSystemLimitAction", async () => {
    const raw = String(formData.get("value") ?? "").trim();
    const scale = Number(formData.get("scale") ?? 1);
    const value = raw === "" ? Number.NaN : Math.round(Number(raw) * (Number.isFinite(scale) ? scale : 1));
    try {
      const saved = await updateSystemLimit(await getActorUserId(), String(formData.get("key") ?? ""), {
        value,
        updatedAt: String(formData.get("updatedAt") ?? ""),
      });
      revalidatePath("/admin/settings");
      return { status: "success", message: "Limit saved.", updatedAt: saved.updatedAt };
    } catch (error) {
      if (error instanceof SystemLimitValueError) {
        return { status: "error", message: error.message, fieldError: error.message };
      }
      if (!(error instanceof AuthorizationError)) captureException(error);
      return { status: "error", message: errorMessage(error, "The limit could not be saved.") };
    }
  });
}
