import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn(async () => {
    throw new Error("Unexpected network request: install a response fixture");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const context = (text = "example.com", settings = {}, signal = new AbortController().signal) => ({
  input: { text, files: [] },
  settings,
  signal,
});
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
import { run as rating } from "./run.server.ts";
const config = vi.hoisted(() => ({ integrations: { ahrefsApiKey: "" } }));
// The key is resolved through runtime settings, which trim the stored value.
vi.mock("@/lib/config/integrations.ts", () => ({ ahrefsApiKey: async () => config.integrations.ahrefsApiKey.trim() }));
beforeEach(() => {
  config.integrations.ahrefsApiKey = "";
});

describe("domain-rating-checker: validated server transport", () => {
  const validPayload = {
    domain_rating: { domain_rating: 52.5, license: "https://ahrefs.com/legal/domain-rating-license" },
  };
  test.each([
    undefined,
    null,
    42,
    "",
    " ",
    "localhost",
    "127.0.0.1",
    "http://[::1]",
    "ftp://example.com",
    "javascript:alert(1)",
    "example.com/path",
    "example.com?x=1",
    "https://user:password@example.com",
    "https://-bad.example",
    "https://bad-.example",
    "a".repeat(64) + ".com",
    "a".repeat(2049),
  ])("rejects unsafe or invalid target %j before contacting Ahrefs", async (input) => {
    await expect(rating({ ...context(), input: { text: input } })).rejects.toMatchObject({ code: "invalid-target" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test.each([
    [" HTTPS://WWW.Example.COM:443/path?secret=hidden#fragment ", "www.example.com"],
    ["EXAMPLE.COM.", "example.com"],
    ["https://bücher.example", "xn--bcher-kva.example"],
  ])("normalizes %j to target %s without forwarding URL details", async (input, target) => {
    fetchMock.mockResolvedValue(response(validPayload));
    const result = await rating(context(input));
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`https://api.ahrefs.com/v3/public/domain-rating-free?target=${target}&output=json`);
    expect(options).toMatchObject({ cache: "no-store", headers: { Accept: "application/json" } });
    expect(options.headers.Authorization).toBeUndefined();
    expect(result.domainRating.target).toBe(target);
    expect(result.downloadName).toBe(`${target}-domain-rating.txt`);
  });
  test("configured credential is confined to Authorization and absent from results", async () => {
    config.integrations.ahrefsApiKey = " test-only-placeholder ";
    fetchMock.mockResolvedValue(response(validPayload));
    const result = await rating(context());
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-only-placeholder");
    expect(JSON.stringify(result)).not.toContain("test-only-placeholder");
  });
  test.each([
    [401, "upstream-rejected"],
    [403, "upstream-rejected"],
    [429, "upstream-rate-limited"],
    [500, "upstream-failed"],
    [503, "upstream-failed"],
  ])("maps HTTP %i to %s", async (status, code) => {
    fetchMock.mockResolvedValue(response({}, status));
    await expect(rating(context())).rejects.toMatchObject({ code });
  });
  test("transport errors expose a recoverable upstream error", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    await expect(rating(context())).rejects.toMatchObject({ code: "upstream-unreachable" });
  });
  test("the ten-second deadline terminates a pending Ahrefs request without canceling the caller", async () => {
    const caller = new AbortController();
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    fetchMock.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const output = rating(context("example.com", {}, caller.signal));
    const failed = expect(output).rejects.toMatchObject({
      code: "upstream-unreachable",
      message: expect.stringMatching(/try again/i),
    });
    // The API key is resolved asynchronously before the request starts.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(timeout).toHaveBeenCalledWith(10_000);
    deadline.abort(new DOMException("Ahrefs timed out", "TimeoutError"));
    await failed;
    expect(caller.signal.aborted).toBe(false);
  });
  test("caller cancellation remains cancellation rather than an upstream failure", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async (_url, { signal }) => {
      controller.abort();
      signal.throwIfAborted();
    });
    await expect(rating(context("example.com", {}, controller.signal))).rejects.toMatchObject({ name: "AbortError" });
  });
  test("an already canceled lookup never contacts Ahrefs", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(rating(context("example.com", {}, controller.signal))).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("cancellation while reading the response body remains cancellation", async () => {
    const controller = new AbortController();
    let requestSignal;
    // Fetch aborts response-body consumption after headers have arrived too.
    const json = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          requestSignal.addEventListener("abort", () => reject(requestSignal.reason), { once: true });
        }),
    );
    fetchMock.mockImplementation(async (_url, { signal }) => {
      requestSignal = signal;
      return { ok: true, status: 200, json };
    });
    const output = rating(context("example.com", {}, controller.signal));
    await vi.waitFor(() => expect(json).toHaveBeenCalledOnce());
    controller.abort();
    await expect(output).rejects.toMatchObject({ name: "AbortError" });
  });
  test.each([null, [], "unexpected", {}, { domain_rating: [] }, { domain_rating: null }])(
    "rejects malformed payload %j",
    async (data) => {
      fetchMock.mockResolvedValue(response(data));
      await expect(rating(context())).rejects.toMatchObject({ code: "upstream-invalid" });
    },
  );
  test("rejects malformed JSON with a stable error", async () => {
    fetchMock.mockResolvedValue(new Response("<html>proxy error</html>"));
    await expect(rating(context())).rejects.toMatchObject({ code: "upstream-invalid" });
  });
  test("accepts exact maximum license and warning lengths without truncation", async () => {
    const license = "l".repeat(1000),
      warning = "w".repeat(2000);
    fetchMock.mockResolvedValue(response({ domain_rating: { domain_rating: 100, license, warning } }));
    const result = await rating(context());
    expect(result.domainRating).toEqual({ target: "example.com", score: 100, license, warning });
    expect(result.text).toContain(`License: ${license}\nWarning: ${warning}`);
  });
});
