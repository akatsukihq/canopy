import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { sendAuthEmail } from "@/lib/auth/email.ts";

vi.mock("server-only", () => ({}));

const accountId = "0123456789abcdef0123456789abcdef";
const message = {
  to: "recipient@example.com",
  subject: "Verify your account",
  heading: "Verify your account",
  actionLabel: "Verify email",
  actionUrl: "http://localhost:3000/api/auth/verify-email?token=test&callbackURL=%2F",
};
const delivered = {
  success: true,
  errors: [],
  messages: [],
  result: { delivered: [message.to], permanent_bounces: [], queued: [] },
};

beforeEach(() => {
  vi.stubEnv("CLOUDFLARE_EMAIL_ACCOUNT_ID", ` ${accountId} `);
  vi.stubEnv("CLOUDFLARE_EMAIL_API_TOKEN", " test-email-token ");
  vi.stubEnv("ACCOUNTS_EMAIL", "  accounts@smarttools.lol  ");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(delivered)));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("account email sends authenticated Cloudflare JSON with its shared sender and usable HTML and text", async () => {
  await sendAuthEmail(message);
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`);
  expect(options.method).toBe("POST");
  expect(options.headers).toEqual({
    Authorization: "Bearer test-email-token",
    "Content-Type": "application/json",
  });
  expect(options.signal).toBeInstanceOf(AbortSignal);
  const payload = JSON.parse(options.body);
  expect(payload.from).toEqual({ address: "accounts@smarttools.lol", name: "SmartTools Accounts" });
  expect(payload.to).toEqual([message.to]);
  expect(payload.subject).toBe(message.subject);
  expect(payload.html).toContain("This link expires automatically.");
  expect(payload.html).toContain("token=test&amp;callbackURL=%2F");
  expect(payload.text).toContain("This link expires automatically.");
  expect(payload.text).toContain(`${message.actionLabel}: ${message.actionUrl}`);
});

test.each(["CLOUDFLARE_EMAIL_ACCOUNT_ID", "CLOUDFLARE_EMAIL_API_TOKEN", "ACCOUNTS_EMAIL"])(
  "missing or blank %s stops before contacting the provider",
  async (key) => {
    for (const value of [undefined, "", "   "]) {
      vi.stubEnv(key, value);
      await expect(sendAuthEmail(message)).rejects.toThrow(key);
    }
    expect(fetch).not.toHaveBeenCalled();
  },
);

test("queued mail and a normalized recipient address count as accepted delivery", async () => {
  fetch.mockResolvedValueOnce(
    Response.json({
      ...delivered,
      result: { delivered: [], permanent_bounces: [], queued: [message.to.toUpperCase()] },
    }),
  );
  await expect(sendAuthEmail(message)).resolves.toBeUndefined();
});

test.each([
  { success: false, errors: [{ message: "private provider detail" }], result: null },
  null,
  { success: true },
  { success: true, result: null },
  { success: true, result: { delivered: message.to, permanent_bounces: [], queued: [] } },
  { ...delivered, result: { delivered: [], permanent_bounces: [], queued: [] } },
  { ...delivered, result: { delivered: ["someone-else@example.com"], permanent_bounces: [], queued: [] } },
  { ...delivered, result: { delivered: [], permanent_bounces: [message.to], queued: [] } },
  { ...delivered, result: { ...delivered.result, permanent_bounces: [message.to] } },
  { ...delivered, result: { ...delivered.result, suppressed_recipients: [message.to] } },
])("unsuccessful, bounced, suppressed, or malformed responses fail safely: %j", async (body) => {
  fetch.mockResolvedValueOnce(Response.json(body));
  await expect(sendAuthEmail(message)).rejects.toThrow(/^Unable to send authentication email$/);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([401, 403, 429, 500])("HTTP %s is a delivery failure even with a success body", async (status) => {
  fetch.mockResolvedValueOnce(Response.json(delivered, { status }));
  await expect(sendAuthEmail(message)).rejects.toThrow(/^Unable to send authentication email$/);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("non-JSON, network, and timeout failures are sanitized and never retried", async () => {
  fetch.mockResolvedValueOnce(new Response("private upstream detail"));
  fetch.mockRejectedValueOnce(new Error("private network detail"));
  fetch.mockRejectedValueOnce(new DOMException("private timeout detail", "TimeoutError"));
  for (let index = 0; index < 3; index++) {
    await expect(sendAuthEmail(message)).rejects.toThrow(/^Unable to send authentication email$/);
    expect(fetch).toHaveBeenCalledTimes(index + 1);
  }
});

test("confirmation copy is escaped in HTML and preserved in plain text", async () => {
  await sendAuthEmail({
    ...message,
    subject: "Your password was changed",
    heading: 'Password <changed> & "secured"',
    message: "Changed <safely> & successfully.",
    actionLabel: "Secure 'your' account",
    actionUrl: 'http://localhost:3000/auth?mode=forgot&value="test"',
  });
  const { html, text } = JSON.parse(fetch.mock.calls[0][1].body);
  expect(html).toContain("Password &lt;changed&gt; &amp; &quot;secured&quot;");
  expect(html).toContain("Changed &lt;safely&gt; &amp; successfully.");
  expect(html).toContain("Secure &#39;your&#39; account");
  expect(html).toContain("mode=forgot&amp;value=&quot;test&quot;");
  expect(html).not.toMatch(/expires automatically|ignore this email/);
  expect(text).toContain("Changed <safely> & successfully.");
  expect(text).toContain('http://localhost:3000/auth?mode=forgot&value="test"');
  expect(text).not.toMatch(/expires automatically|ignore this email/);
});
