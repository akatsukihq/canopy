import { z } from "zod";
import type { EmailSender, EmailMessage } from "../sender.ts";

const deliveryResponse = z.object({
  success: z.literal(true),
  result: z.object({
    delivered: z.array(z.string()),
    queued: z.array(z.string()),
    permanent_bounces: z.array(z.string()),
    suppressed_recipients: z.array(z.string()).optional(),
  }),
});

export class CloudflareEmailSender implements EmailSender {
  static readonly type = "cloudflare";
  readonly type = CloudflareEmailSender.type;
  private readonly accountId: string;
  private readonly apiToken: string;

  constructor({ accountId, apiToken }: { accountId: string; apiToken: string }) {
    this.accountId = accountId;
    this.apiToken = apiToken;
  }

  /**
   * Cloudflare has no email-specific dry run, so this checks that the token is active.
   * Account-owned tokens verify under the account; user tokens only under /user.
   * It cannot prove the token has the Email Sending permission.
   */
  async verify(): Promise<void> {
    const base = "https://api.cloudflare.com/client/v4";
    const urls = [`${base}/accounts/${encodeURIComponent(this.accountId)}/tokens/verify`, `${base}/user/tokens/verify`];
    let rejected = false;
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${this.apiToken}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) return;
        if (response.status < 500) rejected = true;
      } catch {
        // Network failure: try the next endpoint, then report unreachable.
      }
    }
    throw new Error(rejected ? "The provider rejected these credentials." : "Could not reach the provider.");
  }

  async send(message: EmailMessage): Promise<void> {
    if (message.to.length === 0) throw new Error("At least one email recipient is required");

    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/email/sending/send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok) throw new Error("Email request failed");

      const { result } = deliveryResponse.parse(await response.json());
      const accepted = new Set([...result.delivered, ...result.queued].map((address) => address.toLowerCase()));
      if (
        result.permanent_bounces.length > 0 ||
        (result.suppressed_recipients?.length ?? 0) > 0 ||
        message.to.some((address) => !accepted.has(address.toLowerCase()))
      ) {
        throw new Error("Email delivery failed");
      }
    } catch {
      // Provider responses and network errors can contain credentials or recipient details.
      throw new Error("Unable to send email");
    }
  }
}
