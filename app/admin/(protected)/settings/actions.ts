"use server";

import { captureException } from "@sentry/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActorUserId } from "@/lib/admin/access";
import { AuthorizationError } from "@/lib/admin/index.ts";
import { RuntimeSettingValueError, saveSettings } from "@/lib/admin/runtimeSettings.ts";
import { SystemLimitValueError } from "@/lib/admin/systemLimits.ts";
import { measureServerAction } from "@/lib/observability/sentry.ts";
import { errorMessage } from "@/utils/errorMessage.ts";

export type SettingsActionState = {
  status: "idle" | "success" | "error";
  message: string;
  /** Set when a value was rejected, so the form shows it beside that field. */
  fieldErrors?: Record<string, string>;
};

const changesSchema = z.object({
  limits: z.array(z.object({ key: z.string().max(100), value: z.number(), updatedAt: z.string().max(40) })).max(50),
  runtime: z
    .array(z.object({ key: z.string().max(100), value: z.union([z.string().max(320), z.boolean(), z.null()]) }))
    .max(50),
});

/** Saves every change on one Settings page in a single transaction; a rejected value saves nothing. */
export async function saveSettingsAction(
  _previous: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  return measureServerAction<SettingsActionState>("admin.settings.saveSettingsAction", async () => {
    let changes: z.infer<typeof changesSchema>;
    try {
      changes = changesSchema.parse(JSON.parse(String(formData.get("changes") ?? "")));
    } catch {
      return { status: "error", message: "The changes could not be read. Reload and try again." };
    }
    if (!changes.limits.length && !changes.runtime.length) return { status: "idle", message: "" };
    try {
      await saveSettings(await getActorUserId(), changes);
      revalidatePath("/admin/settings", "layout");
      return { status: "success", message: "Settings saved." };
    } catch (error) {
      if (error instanceof SystemLimitValueError || error instanceof RuntimeSettingValueError) {
        return {
          status: "error",
          message: "Nothing was saved. Fix the highlighted field.",
          fieldErrors: { [error.key]: error.message },
        };
      }
      if (!(error instanceof AuthorizationError)) captureException(error);
      return { status: "error", message: errorMessage(error, "The settings could not be saved.") };
    }
  });
}
