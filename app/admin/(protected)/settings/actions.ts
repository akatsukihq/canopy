"use server";

import { captureException } from "@sentry/core";
import { revalidatePath } from "next/cache";
import { getActorUserId } from "@/lib/admin/access";
import { AuthorizationError } from "@/lib/admin/index.ts";
import { RuntimeSettingValueError, updateRuntimeSetting } from "@/lib/admin/runtimeSettings.ts";
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
      revalidatePath("/admin/settings", "layout");
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

export type RuntimeSettingActionState = {
  status: "idle" | "success" | "error";
  message: string;
  /** Set when the value itself was rejected, so the card shows it beside the field. */
  fieldError?: string;
};

/** Saves an override, or clears it when `reset` is set so the environment value applies again. */
export async function updateRuntimeSettingAction(
  _previous: RuntimeSettingActionState,
  formData: FormData,
): Promise<RuntimeSettingActionState> {
  return measureServerAction<RuntimeSettingActionState>("admin.settings.updateRuntimeSettingAction", async () => {
    const reset = formData.get("reset") === "true";
    const raw = String(formData.get("value") ?? "");
    const value = reset ? null : raw === "true" ? true : raw === "false" ? false : raw;
    try {
      await updateRuntimeSetting(await getActorUserId(), String(formData.get("key") ?? ""), value);
      revalidatePath("/admin/settings", "layout");
      return { status: "success", message: reset ? "Reverted to the environment value." : "Setting saved." };
    } catch (error) {
      if (error instanceof RuntimeSettingValueError) {
        return { status: "error", message: error.message, fieldError: error.message };
      }
      if (!(error instanceof AuthorizationError)) captureException(error);
      return { status: "error", message: errorMessage(error, "The setting could not be saved.") };
    }
  });
}
