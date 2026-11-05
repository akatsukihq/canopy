import { afterEach, beforeEach, expect, test, vi } from "vitest";

const transport = { sendMail: vi.fn(), verify: vi.fn() };
const createTransport = vi.fn(() => transport);
vi.mock("nodemailer", () => ({ default: { createTransport } }));

const { createEmailSender, emailConfigFromEnv, getEmailSender } = await import("@/lib/email/sender.ts");
const { CloudflareEmailSender } = await import("@/lib/email/senders/cloudflare.ts");
const { ResendEmailSender } = await import("@/lib/email/senders/resend.ts");
const { SmtpEmailSender } = await import("@/lib/email/senders/smtp.ts");

const SECRET = "re_super_secret_key";
const base = {
  provider: "cloudflare",
  cloudflare: { accountId: "acct-1", apiToken: "cf-secret-token" },
  resend: { apiKey: SECRET },
  smtp: { host: "smtp.example.com", port: 465, secure: true, user: "mailer", password: "smtp-secret-pass" },
};
const message = {
  from: { address: "accounts@example.com", name: "Example Accounts" },
  to: ["user@example.com"],
  subject: "Hello",
  html: "<p>Hi</p>",
  text: "Hi",
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id: "email-1" })));
  transport.sendMail.mockReset().mockResolvedValue({ accepted: message.to, rejected: [] });
  transport.verify.mockReset().mockResolvedValue(true);
  createTransport.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("createEmailSender picks the sender class for each provider", () => {
  expect(createEmailSender(base)).toBeInstanceOf(CloudflareEmailSender);
  expect(createEmailSender({ ...base, provider: "resend" })).toBeInstanceOf(ResendEmailSender);
  expect(createEmailSender({ ...base, provider: "smtp" })).toBeInstanceOf(SmtpEmailSender);
  expect(createTransport).toHaveBeenCalledWith(
    expect.objectContaining({ host: "smtp.example.com", port: 465, secure: true, auth: { user: "mailer", pass: "smtp-secret-pass" } }),
  );
});

test("an unknown provider is rejected without echoing it", () => {
  expect(() => createEmailSender({ ...base, provider: "private-value" })).toThrow(/^Unsupported EMAIL_PROVIDER/);
  expect(() => createEmailSender({ ...base, provider: "private-value" })).not.toThrow(/private-value/);
});

test("missing fields are named, present values are never echoed", () => {
  const cases = [
    [{ ...base, cloudflare: { accountId: "acct-1", apiToken: "  " } }, /apiToken/, /acct-1/],
    [{ ...base, provider: "resend", resend: { apiKey: "" } }, /apiKey/, null],
    [{ ...base, provider: "smtp", smtp: { ...base.smtp, host: "", password: "" } }, /host.*password/, /mailer|smtp-secret/],
    [{ ...base, provider: "smtp", smtp: { ...base.smtp, port: Number.NaN } }, /port/, /smtp-secret/],
  ];
  for (const [config, names, leak] of cases) {
    expect(() => createEmailSender(config)).toThrow(/is not configured/);
    expect(() => createEmailSender(config)).toThrow(names);
    if (leak) expect(() => createEmailSender(config)).not.toThrow(leak);
  }
  expect(() => createEmailSender({ ...base, provider: "smtp", smtp: { ...base.smtp, host: "" } })).not.toThrow(/user/);
});

test("Resend sends the documented request shape", async () => {
  await createEmailSender({ ...base, provider: "resend" }).send(message);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("https://api.resend.com/emails");
  expect(options.method).toBe("POST");
  expect(options.headers).toEqual({ Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" });
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(options.body)).toEqual({
    from: "Example Accounts <accounts@example.com>",
    to: message.to,
    subject: "Hello",
    html: "<p>Hi</p>",
    text: "Hi",
  });
});

test("Resend failures map to a generic message without the key", async () => {
  const sender = new ResendEmailSender({ apiKey: SECRET });
  fetch.mockResolvedValueOnce(Response.json({ message: `bad key ${SECRET}` }, { status: 403 }));
  await expect(sender.send(message)).rejects.toThrow(/^Unable to send email$/);
  fetch.mockRejectedValueOnce(new Error(`network ${SECRET}`));
  await expect(sender.send(message)).rejects.toThrow(/^Unable to send email$/);
  await expect(sender.send({ ...message, to: [] })).rejects.toThrow(/recipient/);
});

test("Resend verify checks domains and maps failures to safe messages", async () => {
  const sender = new ResendEmailSender({ apiKey: SECRET });
  await expect(sender.verify()).resolves.toBeUndefined();
  expect(fetch.mock.calls[0][0]).toBe("https://api.resend.com/domains");
  expect(fetch.mock.calls[0][1].method).toBeUndefined();

  fetch.mockResolvedValueOnce(Response.json({ name: "restricted_api_key" }, { status: 401 }));
  await expect(sender.verify()).resolves.toBeUndefined();
  fetch.mockResolvedValueOnce(Response.json({ name: "validation_error", message: SECRET }, { status: 401 }));
  await expect(sender.verify()).rejects.toThrow(/^The provider rejected these credentials\.$/);
  fetch.mockResolvedValueOnce(new Response("down", { status: 503 }));
  await expect(sender.verify()).rejects.toThrow(/^Could not reach the provider\.$/);
  fetch.mockRejectedValueOnce(new Error(SECRET));
  await expect(sender.verify()).rejects.toThrow(/^Could not reach the provider\.$/);
});

test("Cloudflare verify accepts an active account or user token and rejects otherwise", async () => {
  const sender = new CloudflareEmailSender(base.cloudflare);
  await expect(sender.verify()).resolves.toBeUndefined();
  expect(fetch.mock.calls[0][0]).toBe("https://api.cloudflare.com/client/v4/accounts/acct-1/tokens/verify");

  fetch.mockReset().mockResolvedValueOnce(new Response("", { status: 401 })).mockResolvedValueOnce(Response.json({}));
  await expect(sender.verify()).resolves.toBeUndefined();
  expect(fetch.mock.calls[1][0]).toBe("https://api.cloudflare.com/client/v4/user/tokens/verify");

  fetch.mockReset().mockResolvedValue(new Response("", { status: 401 }));
  await expect(sender.verify()).rejects.toThrow(/^The provider rejected these credentials\.$/);
  fetch.mockReset().mockRejectedValue(new Error("cf-secret-token"));
  await expect(sender.verify()).rejects.toThrow(/^Could not reach the provider\.$/);
});

test("SMTP send and verify go through the transport with safe errors", async () => {
  const sender = createEmailSender({ ...base, provider: "smtp" });
  await sender.send(message);
  expect(transport.sendMail).toHaveBeenCalledWith({
    from: { name: "Example Accounts", address: "accounts@example.com" },
    to: message.to,
    subject: "Hello",
    html: "<p>Hi</p>",
    text: "Hi",
  });
  await expect(sender.verify()).resolves.toBeUndefined();
  expect(transport.verify).toHaveBeenCalledTimes(1);

  transport.sendMail.mockResolvedValueOnce({ accepted: [], rejected: message.to });
  await expect(sender.send(message)).rejects.toThrow(/^Unable to send email$/);
  transport.sendMail.mockRejectedValueOnce(new Error("535 auth smtp-secret-pass"));
  await expect(sender.send(message)).rejects.toThrow(/^Unable to send email$/);
  transport.verify.mockRejectedValueOnce(Object.assign(new Error("smtp-secret-pass"), { code: "EAUTH" }));
  await expect(sender.verify()).rejects.toThrow(/^The provider rejected these credentials\.$/);
  transport.verify.mockRejectedValueOnce(Object.assign(new Error("smtp-secret-pass"), { code: "ECONNECTION" }));
  await expect(sender.verify()).rejects.toThrow(/^Could not reach the provider\.$/);
});

test("emailConfigFromEnv reads env values with SMTP defaults", () => {
  for (const key of ["EMAIL_PROVIDER", "CLOUDFLARE_EMAIL_ACCOUNT_ID", "CLOUDFLARE_EMAIL_API_TOKEN", "RESEND_API_KEY", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD"]) {
    vi.stubEnv(key, undefined);
  }
  expect(emailConfigFromEnv()).toEqual({
    provider: "cloudflare",
    cloudflare: { accountId: "", apiToken: "" },
    resend: { apiKey: "" },
    smtp: { host: "", port: 587, secure: false, user: "", password: "" },
  });

  vi.stubEnv("EMAIL_PROVIDER", "smtp");
  vi.stubEnv("SMTP_HOST", "mail.example.com");
  vi.stubEnv("SMTP_PORT", "2525");
  vi.stubEnv("SMTP_SECURE", "true");
  vi.stubEnv("SMTP_USER", "u");
  vi.stubEnv("SMTP_PASSWORD", "p");
  vi.stubEnv("RESEND_API_KEY", "rk");
  const config = emailConfigFromEnv();
  expect(config.provider).toBe("smtp");
  expect(config.resend.apiKey).toBe("rk");
  expect(config.smtp).toEqual({ host: "mail.example.com", port: 2525, secure: true, user: "u", password: "p" });
  expect(getEmailSender()).toBeInstanceOf(SmtpEmailSender);
  expect(getEmailSender("resend")).toBeInstanceOf(ResendEmailSender);
});
