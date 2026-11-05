"use server";

import { captureException } from "@sentry/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActorUserId } from "@/lib/admin/access";
import { authUser, db, eq } from "@/db/index.ts";
import { AuthorizationError, requirePermission } from "@/lib/admin/index.ts";
import { activateProvider, RuntimeSettingValueError, saveSettings } from "@/lib/admin/runtimeSettings.ts";
import { AIError } from "@/lib/ai/errors.ts";
import { listModels } from "@/lib/ai/models.ts";
import { accountsFromAddress, aiCredentials, emailConfig } from "@/lib/config/integrations.ts";
import { loadRuntimeSettings } from "@/lib/config/runtimeSettings.ts";
import { createEmailSender, EMAIL_PROVIDERS, type EmailProvider } from "@/lib/email/sender.ts";
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

export type ProviderActionState = { status: "idle" | "success" | "error"; message: string; models?: string[] };

async function requireSettingsEditor(): Promise<string> {
  const actor = await getActorUserId();
  await requirePermission(actor, "settings", "edit");
  return actor;
}

const failure = (error: unknown, fallback: string): ProviderActionState => {
  if (!(error instanceof AuthorizationError) && !(error instanceof RuntimeSettingValueError)) captureException(error);
  // Messages from these modules are written to be safe; anything else gets the fallback.
  return {
    status: "error",
    message:
      error instanceof RuntimeSettingValueError || error instanceof AuthorizationError || error instanceof AIError
        ? error.message
        : fallback,
  };
};

/** Makes a fully configured provider the active one. Confirmed in the UI first. */
export async function activateProviderAction(setting: string, provider: string): Promise<ProviderActionState> {
  return measureServerAction<ProviderActionState>("admin.settings.activateProviderAction", async () => {
    try {
      await activateProvider(await getActorUserId(), setting, provider);
      revalidatePath("/admin/settings", "layout");
      return { status: "success", message: "Provider switched." };
    } catch (error) {
      return failure(error, "The provider could not be switched.");
    }
  });
}

/**
 * Lists the models a key can use. `apiKey` is the unsaved key typed in the form;
 * empty uses the saved one. Doubles as the AI connection test.
 */
export async function listModelsAction(
  provider: string,
  apiKey: string,
  baseUrl = "",
): Promise<ProviderActionState> {
  return measureServerAction<ProviderActionState>("admin.settings.listModelsAction", async () => {
    try {
      await requireSettingsEditor();
      if (provider !== "openai" && provider !== "anthropic" && provider !== "compatible")
        throw new Error("Unknown AI provider.");
      const saved = aiCredentials(await loadRuntimeSettings(), provider);
      const key = apiKey.trim() || saved.apiKey;
      const url = baseUrl.trim() || ("baseUrl" in saved ? saved.baseUrl : "");
      if (provider === "compatible") {
        // Same check the setting applies on save; the draft has not been validated yet.
        if (!url || !/^https?:\/\/\S+$/.test(url) || !URL.canParse(url))
          return { status: "error", message: "Add an http(s) base URL first." };
      } else if (!key) return { status: "error", message: "Add an API key first." };
      const models = await listModels(provider, key, undefined, url);
      return {
        status: "success",
        message: models.length ? `Key works. ${models.length} models available.` : "Key works, but it lists no chat models.",
        models,
      };
    } catch (error) {
      return failure(error, "Could not reach the provider. Try again.");
    }
  });
}

/** Checks the saved credentials, then sends a test email to the signed-in admin. */
export async function testEmailAction(provider: string): Promise<ProviderActionState> {
  return measureServerAction<ProviderActionState>("admin.settings.testEmailAction", async () => {
    try {
      const actor = await requireSettingsEditor();
      if (!(EMAIL_PROVIDERS as readonly string[]).includes(provider)) throw new Error("Unknown email provider.");
      const settings = await loadRuntimeSettings();
      const from = accountsFromAddress(settings);
      if (!from) return { status: "error", message: "Save a From address first." };
      const [user] = await db.select({ email: authUser.email }).from(authUser).where(eq(authUser.id, actor)).limit(1);
      if (!user?.email) return { status: "error", message: "Your account has no email address to send the test to." };
      let sender;
      try {
        sender = createEmailSender(emailConfig(settings, provider as EmailProvider));
      } catch (error) {
        return { status: "error", message: error instanceof Error ? error.message : "This provider is not configured." };
      }
      await sender.verify();
      await sender.send({
        from: { address: from, name: "SmartTools Accounts" },
        to: [user.email],
        subject: "SmartTools test email",
        html: "<p>This test email confirms the email provider settings work.</p>",
        text: "This test email confirms the email provider settings work.",
      });
      return { status: "success", message: `Test email sent to ${user.email}.` };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error && /provider|credentials|reach|send/i.test(error.message)
          ? error.message
          : "The test email could not be sent.",
      };
    }
  });
}
