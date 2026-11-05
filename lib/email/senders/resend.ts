import type { EmailSender, EmailMessage } from "../sender.ts";

const API = "https://api.resend.com";

export class ResendEmailSender implements EmailSender {
  static readonly type = "resend";
  readonly type = ResendEmailSender.type;
  private readonly apiKey: string;

  constructor({ apiKey }: { apiKey: string }) {
    this.apiKey = apiKey;
  }

  private request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  }

  async send(message: EmailMessage): Promise<void> {
    if (message.to.length === 0) throw new Error("At least one email recipient is required");
    // Strip characters that would break the "Name <address>" header form.
    const name = message.from.name?.replace(/[\r\n<>"]/g, "").trim();
    try {
      const response = await this.request("/emails", {
        method: "POST",
        body: JSON.stringify({
          from: name ? `${name} <${message.from.address}>` : message.from.address,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      if (!response.ok) throw new Error("Email request failed");
    } catch {
      // Provider responses and network errors can contain credentials or recipient details.
      throw new Error("Unable to send email");
    }
  }

  async verify(): Promise<void> {
    let response: Response;
    try {
      response = await this.request("/domains");
    } catch {
      throw new Error("Could not reach the provider.");
    }
    if (response.ok) return;
    // A sending-only key is valid but may not list domains; Resend names that case explicitly.
    const body: unknown = await response.json().catch(() => null);
    if (body && typeof body === "object" && "name" in body && body.name === "restricted_api_key") return;
    throw new Error(
      response.status >= 500 ? "Could not reach the provider." : "The provider rejected these credentials.",
    );
  }
}
