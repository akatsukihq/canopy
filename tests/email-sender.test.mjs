import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CloudflareEmailSender } from "@/lib/email/senders/cloudflare.ts";
import { getEmailSender } from "@/lib/email/sender.ts";

const accountId = "0123456789abcdef0123456789abcdef";
const message = {
  from: { address: "notifications@example.com", name: "Notifications" },
  to: ["first@example.com", "second@example.com"],
  subject: "Your update",
  html: "<p>Your update is ready.</p>",
  text: "Your update is ready.",
};

function response(result = {}) {
  return Response.json({
    success: true,
    errors: [],
    result: {
      delivered: message.to,
      queued: [],
      permanent_bounces: [],
      ...result,
    },
  });
}

beforeEach(() => {
  vi.stubEnv("EMAIL_PROVIDER", undefined);
  vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", accountId);
  vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "test-email-token");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => response()),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("the default provider sends a shared email message through Cloudflare", async () => {
  const sender = getEmailSender();
  expect(sender.type).toBe("cloudflare");
  await expect(sender.send(message)).resolves.toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`);
  expect(JSON.parse(options.body)).toEqual(message);
});

test("selection using a sender's type overrides the configured default", async () => {
  vi.stubEnv("EMAIL_PROVIDER", "unsupported");
  const sender = getEmailSender(CloudflareEmailSender.type);
  expect(sender.type).toBe("cloudflare");
  await expect(sender.send(message)).resolves.toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("an unsupported configured provider fails without exposing its value or making a request", () => {
  vi.stubEnv("EMAIL_PROVIDER", "private-untrusted-provider-value");
  expect(() => getEmailSender()).toThrow(/^Unsupported EMAIL_PROVIDER/);
  expect(() => getEmailSender()).not.toThrow(/private-untrusted-provider-value/);
  expect(fetch).not.toHaveBeenCalled();
});

test("provider creation reads credentials after environment loading and after later updates", async () => {
  vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", undefined);
  vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", undefined);
  expect(() => getEmailSender()).toThrow(/CLOUDFLARE_EMAIL_/);

  vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", ` ${accountId} `);
  vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", " first-token ");
  await getEmailSender().send(message);

  const nextAccountId = "fedcba9876543210fedcba9876543210";
  vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", nextAccountId);
  vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", "second-token");
  await getEmailSender().send(message);

  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
    `https://api.cloudflare.com/client/v4/accounts/${nextAccountId}/email/sending/send`,
  ]);
  expect(fetch.mock.calls.map(([, options]) => options.headers.Authorization)).toEqual([
    "Bearer first-token",
    "Bearer second-token",
  ]);
});

test("a shared email succeeds when every recipient is delivered or queued", async () => {
  fetch.mockResolvedValueOnce(response({ delivered: [message.to[0]], queued: [message.to[1].toUpperCase()] }));
  await expect(getEmailSender().send(message)).resolves.toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([
  { delivered: [message.to[0]], queued: [] },
  { delivered: [], queued: [message.to[1]] },
  { delivered: [message.to[0], "unrelated@example.com"], queued: [] },
  { delivered: message.to, permanent_bounces: [message.to[1]] },
  { delivered: message.to, suppressed_recipients: [message.to[0]] },
])("partial, bounced, or suppressed recipient delivery rejects the shared send: %j", async (result) => {
  fetch.mockResolvedValueOnce(response(result));
  await expect(getEmailSender().send(message)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("a message with no recipients is rejected before contacting Cloudflare", async () => {
  await expect(getEmailSender().send({ ...message, to: [] })).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

test("the Cloudflare sender reads trimmed environment credentials when selected", async () => {
  vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", ` ${accountId} `);
  vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", " direct-sender-token ");
  await getEmailSender(CloudflareEmailSender.type).send(message);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`);
  expect(options.headers.Authorization).toBe("Bearer direct-sender-token");
});

test.each(["CLOUDFLARE_EMAIL_ACCOUNT_ID", "CLOUDFLARE_EMAIL_API_TOKEN"])(
  "the Cloudflare sender rejects blank %s configuration",
  (key) => {
    for (const value of [undefined, "", "   "]) {
      vi.stubEnv(key, value);
      expect(() => getEmailSender(CloudflareEmailSender.type)).toThrow(key);
    }
    expect(fetch).not.toHaveBeenCalled();
  },
);
