import nodemailer, { type Transporter } from "nodemailer";
import type { EmailConfig, EmailSender, EmailMessage } from "../sender.ts";

export class SmtpEmailSender implements EmailSender {
  static readonly type = "smtp";
  readonly type = SmtpEmailSender.type;
  private readonly transporter: Transporter;

  constructor({ host, port, secure, user, password }: EmailConfig["smtp"]) {
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass: password },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 15_000,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    if (message.to.length === 0) throw new Error("At least one email recipient is required");
    try {
      const info = await this.transporter.sendMail({
        from: { name: message.from.name ?? "", address: message.from.address },
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      if ((info.rejected?.length ?? 0) > 0) throw new Error("Email delivery failed");
    } catch {
      // SMTP errors can echo credentials, server replies, or recipient details.
      throw new Error("Unable to send email");
    }
  }

  async verify(): Promise<void> {
    try {
      await this.transporter.verify();
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      throw new Error(code === "EAUTH" ? "The provider rejected these credentials." : "Could not reach the provider.");
    }
  }
}
