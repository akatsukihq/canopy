import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
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
import { run as dns } from "./run.ts";
const dnsSpec = await toolSpec("dns-checker");
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const dnsContext = (settings = {}, signal) => context("example.com", parseSettings(dnsSpec.settings, settings), signal);

describe("dns-checker: resolver boundaries", () => {
  test.each([400, 403, 429, 500, 503])("HTTP %i fails with a recoverable lookup error", async (status) => {
    fetchMock.mockResolvedValue(response({}, status));
    await expect(dns(dnsContext({ types: "A" }))).rejects.toMatchObject({
      code: "lookup-failed",
      message: `DNS lookup failed (${status}).`,
      recovery: expect.stringMatching(/try again/i),
    });
  });
  test.each([null, [], "unexpected", 0, false])("rejects malformed resolver payload %j", async (data) => {
    fetchMock.mockResolvedValue(response(data));
    await expect(dns(dnsContext({ types: "A" }))).rejects.toMatchObject({ code: "resolver-invalid-response" });
  });
  test("network failure exposes a retry path", async () => {
    fetchMock.mockRejectedValue(new TypeError("network disconnected"));
    await expect(dns(dnsContext({ types: "A" }))).rejects.toMatchObject({
      code: "resolver-unreachable",
      recovery: expect.stringMatching(/connection.*try again/i),
    });
  });
  test("the ten-second deadline terminates a pending resolver request with recovery guidance", async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    fetchMock.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const output = dns(dnsContext({ types: "A" }));
    const failed = expect(output).rejects.toMatchObject({
      code: "resolver-unreachable",
      recovery: expect.stringMatching(/try again/i),
    });
    expect(timeout).toHaveBeenCalledWith(10_000);
    deadline.abort(new DOMException("Resolver timed out", "TimeoutError"));
    await failed;
  });
  test("invalid JSON does not become a successful empty result", async () => {
    fetchMock.mockResolvedValue(new Response("<html>proxy error</html>"));
    await expect(dns(dnsContext({ types: "A" }))).rejects.toThrow();
  });
  test.each([false, true])("recursive=%s is forwarded with optional DNSSEC disabled", async (recursive) => {
    fetchMock.mockResolvedValue(response({ Status: 0 }));
    await dns(dnsContext({ types: "A", recursive, checkDnssec: false }));
    const params = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(params.get("rd")).toBe(recursive ? "1" : "0");
    expect(params.has("do")).toBe(false);
    expect(params.has("cd")).toBe(false);
  });
  test("out-of-order resolver completion preserves selected record order", async () => {
    const pending = {};
    fetchMock.mockImplementation(
      (url) =>
        new Promise((resolve) => {
          pending[new URL(url).searchParams.get("type")] = resolve;
        }),
    );
    const output = dns(dnsContext({ types: "A,MX" }));
    pending.MX(response({ Status: 0, Answer: [{ TTL: 30, data: "10 mail.example.com." }] }));
    pending.A(response({ Status: 0, Answer: [{ TTL: 60, data: "192.0.2.4" }] }));
    expect((await output).text).toBe("A\t60\t192.0.2.4\nMX\t30\t10 mail.example.com.");
  });
  test("aborting while responses arrive prevents publishing records", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      controller.abort();
      return response({ Status: 0 });
    });
    await expect(dns(dnsContext({ types: "A" }, controller.signal))).rejects.toMatchObject({ name: "AbortError" });
  });
  test("caller cancellation aborts the active resolver transport", async () => {
    const controller = new AbortController();
    let requestSignal, finish;
    fetchMock.mockImplementation((_url, { signal }) => {
      requestSignal = signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const output = dns(dnsContext({ types: "A" }, controller.signal));
    const canceled = expect(output).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    finish(response({ Status: 0 }));
    await canceled;
    expect(requestSignal.aborted).toBe(true);
  });
  test("canceling an active fetch stays cancellation instead of a resolver error", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const output = dns(dnsContext({ types: "A" }, controller.signal));
    controller.abort();
    await expect(output).rejects.toMatchObject({ name: "AbortError" });
  });
  test("an already canceled lookup never contacts the resolver", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(dns(dnsContext({ types: "A" }, controller.signal))).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
