import config from "../config/config.ts";
import { CloudflareEmailSender } from "./senders/cloudflare.ts";
import { ResendEmailSender } from "./senders/resend.ts";
import { SmtpEmailSender } from "./senders/smtp.ts";

export const EMAIL_PROVIDERS = ["cloudflare", "resend", "smtp"] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

export type EmailConfig = {
  provider: EmailProvider;
  cloudflare: { accountId: string; apiToken: string };
  resend: { apiKey: string };
  smtp: { host: string; port: number; secure: boolean; user: string; password: string };
};

export type EmailMessage = {
  from: { address: string; name?: string };
  to: string[];
  subject: string;
  html: string;
  text: string;
};

export abstract class EmailSender {
  abstract readonly type: EmailProvider;
  abstract send(message: EmailMessage): Promise<void>;
  /** Checks the credentials without sending; throws a generic, credential-free message on failure. */
  abstract verify(): Promise<void>;
}

/** Throws naming only the missing fields (and their env fallback), never any value. */
function requireFields<T extends Record<string, string>>(
  label: string,
  values: T,
  envNames: Record<keyof T, string>,
): T {
  const trimmed = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value?.trim() ?? ""]),
  ) as T;
  const missing = Object.keys(trimmed).filter((key) => !trimmed[key]);
  if (missing.length > 0) {
    const names = missing.map((key) => `${key} (${envNames[key as keyof T]})`).join(", ");
    throw new Error(`${label} is not configured. Missing: ${names}.`);
  }
  return trimmed;
}

export function createEmailSender(config: EmailConfig): EmailSender {
  switch (config.provider) {
    case "cloudflare":
      return new CloudflareEmailSender(
        requireFields("Cloudflare email", config.cloudflare, {
          accountId: "CLOUDFLARE_EMAIL_ACCOUNT_ID",
          apiToken: "CLOUDFLARE_EMAIL_API_TOKEN",
        }),
      );
    case "resend":
      return new ResendEmailSender(requireFields("Resend email", config.resend, { apiKey: "RESEND_API_KEY" }));
    case "smtp": {
      const { port, secure, ...rest } = config.smtp;
      const fields = requireFields("SMTP email", rest, {
        host: "SMTP_HOST",
        user: "SMTP_USER",
        password: "SMTP_PASSWORD",
      });
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error("SMTP email is not configured. Missing: port (SMTP_PORT).");
      }
      return new SmtpEmailSender({ ...fields, port, secure });
    }
    default:
      // Runtime guard: the provider can come from env or stored settings. Never echo it.
      throw new Error(`Unsupported EMAIL_PROVIDER. Use ${EMAIL_PROVIDERS.join(", ")}.`);
  }
}

export function emailConfigFromEnv(): EmailConfig {
  const { provider, accountId, apiToken } = config.email;
  const port = process.env.SMTP_PORT?.trim();
  return {
    // Unvalidated on purpose: createEmailSender rejects unknown providers without echoing them.
    provider: provider as EmailProvider,
    cloudflare: { accountId: accountId ?? "", apiToken: apiToken ?? "" },
    resend: { apiKey: process.env.RESEND_API_KEY ?? "" },
    smtp: {
      host: process.env.SMTP_HOST ?? "",
      port: port ? Number(port) : 587,
      secure: process.env.SMTP_SECURE?.trim() === "true",
      user: process.env.SMTP_USER ?? "",
      password: process.env.SMTP_PASSWORD ?? "",
    },
  };
}

export function getEmailSender(type?: EmailProvider): EmailSender {
  const envConfig = emailConfigFromEnv();
  return createEmailSender({ ...envConfig, provider: type ?? envConfig.provider });
}
