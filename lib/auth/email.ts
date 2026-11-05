import { accountsFromAddress, emailConfig } from "../config/integrations.ts";
import { loadRuntimeSettings } from "../config/runtimeSettings.ts";
import { createEmailSender } from "../email/sender.ts";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

export async function sendAuthEmail({
  to,
  subject,
  heading,
  message = "This link expires automatically. If you did not request it, you can ignore this email.",
  actionLabel,
  actionUrl,
}: {
  to: string;
  subject: string;
  heading: string;
  message?: string;
  actionLabel: string;
  actionUrl: string;
}): Promise<void> {
  // Admin can switch provider or rotate keys without a redeploy.
  const settings = await loadRuntimeSettings();
  const accountsEmail = accountsFromAddress(settings);
  if (!accountsEmail) {
    throw new Error("ACCOUNTS_EMAIL is required");
  }

  const sender = createEmailSender(emailConfig(settings));
  try {
    await sender.send({
      from: { address: accountsEmail, name: "SmartTools Accounts" },
      to: [to],
      subject,
      html: `<main style="font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;color:#172033"><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 18px;background:#155eef;color:white;text-decoration:none;border-radius:8px">${escapeHtml(actionLabel)}</a></p></main>`,
      text: `${heading}\n\n${message}\n\n${actionLabel}: ${actionUrl}`,
    });
  } catch {
    throw new Error("Unable to send authentication email");
  }
}
