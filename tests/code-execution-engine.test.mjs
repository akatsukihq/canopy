import { readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readCodeExecutionConfig } from "@/lib/code-execution/config.ts";
import { CODE_LANGUAGES, getCodeLanguage } from "@/lib/code-execution/languages.ts";
import { createSemaphore } from "@/lib/code-execution/semaphore.ts";
import { buildExecuteBody } from "@/lib/code-execution/piston.ts";
import { runCode } from "@/lib/code-execution/run.ts";
import { MAX_SOURCE_BYTES, validateCodeInput } from "@/lib/code-execution/validate.ts";

const PYTHON = CODE_LANGUAGES["python-compiler"].version;
const ENV = { CODE_EXECUTION_ENABLED: "true", PISTON_URL: "http://piston.test:2000/", PISTON_API_TOKEN: "secret" };

describe("registry", () => {
  test("exactly the 13 Piston tools, each version pinned and resolvable", () => {
    expect(Object.keys(CODE_LANGUAGES)).toHaveLength(13);
    for (const [key, entry] of Object.entries(CODE_LANGUAGES)) {
      expect(getCodeLanguage(key)).toBe(entry);
      expect(entry.versionId).toBe(entry.versions[0].id);
      expect(new Set(entry.versions.map((version) => version.id)).size).toBe(entry.versions.length);
      for (const version of entry.versions) {
        expect(version.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(getCodeLanguage(key, version.id)).toMatchObject({
          language: version.language,
          version: version.version,
        });
      }
      expect(entry.starter.trim()).not.toBe("");
    }
  });
  test("a non-default version resolves to its own Piston runtime; unknown versions fail closed", () => {
    expect(getCodeLanguage("python-compiler", "3.12")).toMatchObject({
      language: "python",
      version: "3.12.0",
      versionId: "3.12",
    });
    expect(getCodeLanguage("cpp-compiler", "c++17")).toMatchObject({
      language: "c++17",
      version: "12.2.0",
      fileName: "main.cpp",
    });
    expect(getCodeLanguage("python-compiler", "2.7")).toBeNull();
    expect(getCodeLanguage("python-compiler", "constructor")).toBeNull();
  });
  test("unknown and prototype keys fail closed", () => {
    expect(getCodeLanguage("nope")).toBeNull();
    expect(getCodeLanguage("constructor")).toBeNull();
  });
  test("every server-run tools/*-compiler folder has an entry", () => {
    const folders = readdirSync(new URL("../tools", import.meta.url)).filter(
      (n) => n.endsWith("-compiler") && !["sql-compiler", "html-compiler"].includes(n), // client-side runners
    );
    for (const folder of folders) expect(CODE_LANGUAGES).toHaveProperty([folder]);
  });
});

describe("config", () => {
  test("valid env, trailing slash trimmed, default concurrency 8", () => {
    expect(readCodeExecutionConfig(ENV)).toEqual({ url: "http://piston.test:2000", token: "secret", maxConcurrent: 8 });
    expect(readCodeExecutionConfig({ ...ENV, CODE_EXECUTION_MAX_CONCURRENT: "4" }).maxConcurrent).toBe(4);
  });
  test.each([
    ["disabled", { CODE_EXECUTION_ENABLED: "" }],
    ["false", { CODE_EXECUTION_ENABLED: "false" }],
    ["no url", { PISTON_URL: "" }],
    ["bad url", { PISTON_URL: "not a url" }],
    ["non-http url", { PISTON_URL: "file:///etc" }],
    ["no token", { PISTON_API_TOKEN: " " }],
    ["bad concurrency", { CODE_EXECUTION_MAX_CONCURRENT: "0" }],
    ["fractional concurrency", { CODE_EXECUTION_MAX_CONCURRENT: "2.5" }],
  ])("fails closed: %s", (_n, over) => expect(readCodeExecutionConfig({ ...ENV, ...over })).toBeNull());
});

describe("validateCodeInput", () => {
  test("accepts normal input, defaults stdin", () =>
    expect(validateCodeInput("print(1)", undefined)).toEqual({ source: "print(1)", stdin: "" }));
  test.each([
    ["", undefined, "source-required"],
    ["x".repeat(MAX_SOURCE_BYTES + 1), undefined, "source-too-large"],
    ["é".repeat(MAX_SOURCE_BYTES / 2 + 1), undefined, "source-too-large"],
    ["a\0b", undefined, "source-nul"],
    ["a\ud800", undefined, "source-encoding"],
    ["ok", "x".repeat(MAX_SOURCE_BYTES + 1), "stdin-too-large"],
    ["ok", "a\0", "stdin-nul"],
    ["ok", "\udc00", "stdin-encoding"],
  ])("rejects %#", (text, stdin, code) => {
    expect(() => validateCodeInput(text, stdin)).toThrowError(expect.objectContaining({ name: "ToolError", code }));
  });
  test("accepts exactly the limit", () =>
    expect(() => validateCodeInput("x".repeat(MAX_SOURCE_BYTES), "")).not.toThrow());
});

describe("semaphore", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const signal = () => new AbortController().signal;

  test("saturates, queues, then hands the slot on release", async () => {
    const gate = createSemaphore(1);
    const first = await gate.acquire(signal(), 5000);
    const second = gate.acquire(signal(), 5000);
    first();
    first(); // idempotent
    const release = await second;
    expect(release).toBeTypeOf("function");
    const third = gate.acquire(signal(), 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await third).toBeNull();
    release();
    expect(await gate.acquire(signal(), 0)).toBeTypeOf("function");
  });

  test("a waiter times out with null and frees its place in line", async () => {
    const gate = createSemaphore(1);
    const held = await gate.acquire(signal(), 0);
    const waiting = gate.acquire(signal(), 5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await waiting).toBeNull();
    held();
    expect(await gate.acquire(signal(), 0)).toBeTypeOf("function");
  });

  test("abort while waiting rejects and does not leak the slot", async () => {
    const gate = createSemaphore(1);
    const held = await gate.acquire(signal(), 0);
    const controller = new AbortController();
    const waiting = gate.acquire(controller.signal, 5000);
    controller.abort(new Error("gone"));
    await expect(waiting).rejects.toThrow("gone");
    held();
    expect(await gate.acquire(signal(), 0)).toBeTypeOf("function");
  });
});

describe("request body", () => {
  test("comes only from registry plus validated input", () => {
    const body = buildExecuteBody(CODE_LANGUAGES["python-compiler"], { source: "print(1)", stdin: "in" });
    expect(body).toEqual({
      language: "python",
      version: PYTHON,
      files: [{ name: "main.py", content: "print(1)" }],
      stdin: "in",
    });
  });
  test("applies registry limit overrides", () => {
    const body = buildExecuteBody(
      { ...CODE_LANGUAGES["java-compiler"], limits: { runMemoryBytes: 1 } },
      { source: "x", stdin: "" },
    );
    expect(body.run_memory_limit).toBe(1);
  });
});

describe("runCode", () => {
  let fetchMock;
  let urlCounter = 0;
  const runtimes = [{ language: "python", version: PYTHON, aliases: ["py"] }];
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const okRun = {
    language: "python",
    version: PYTHON,
    run: {
      stdout: "Hello, world!\n",
      stderr: "",
      output: "Hello, world!\n",
      code: 0,
      signal: null,
      status: null,
      cpu_time: 10,
      wall_time: 20,
      memory: 1_000_000,
    },
  };
  const signal = () => new AbortController().signal;

  beforeEach(() => {
    // A unique URL per test isolates the module-level runtime cache.
    for (const [k, v] of Object.entries({
      ...ENV,
      PISTON_URL: `http://piston-${++urlCounter}.test`,
      CODE_EXECUTION_MAX_CONCURRENT: "",
    }))
      vi.stubEnv(k, v);
    fetchMock = vi.fn(async (url) => (String(url).endsWith("/runtimes") ? json(runtimes) : json(okRun)));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("runs end to end with bearer auth and a server-built body", async () => {
    const result = await runCode("python-compiler", { text: "print('hi')", secondary: "in" }, signal());
    expect(result.verdict).toMatchObject({ level: "ok" });
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/execute"));
    expect(init.headers.authorization).toBe("Bearer secret");
    expect(JSON.parse(init.body)).toMatchObject({ language: "python", version: PYTHON, stdin: "in" });
  });

  test("the chosen version reaches the engine", async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith("/runtimes")
        ? json([{ language: "python", version: "3.13.18", aliases: [] }])
        : json({ ...okRun, version: "3.13.18" }),
    );
    const result = await runCode("python-compiler", { text: "print('hi')" }, signal(), "3.13");
    expect(result.verdict).toMatchObject({ level: "ok" });
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/execute"));
    expect(JSON.parse(init.body)).toMatchObject({ language: "python", version: "3.13.18" });
  });

  test("unknown key or version rejects, invalid input rejects before any network call", async () => {
    await expect(runCode("evil-compiler", { text: "x" }, signal())).rejects.toMatchObject({ code: "unknown-tool" });
    await expect(runCode("python-compiler", { text: "x" }, signal(), "2.7")).rejects.toMatchObject({
      code: "unknown-tool",
    });
    await expect(runCode("python-compiler", { text: "a\0" }, signal())).rejects.toMatchObject({ code: "source-nul" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("not configured is unavailable without calling the engine", async () => {
    vi.stubEnv("CODE_EXECUTION_ENABLED", "");
    const result = await runCode("python-compiler", { text: "x" }, signal());
    expect(result.verdict.label).toBe("Code execution is not available right now.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("missing pinned runtime is unavailable and never executes", async () => {
    fetchMock.mockImplementation(async () => json([{ language: "python", version: "3.9.0" }]));
    const result = await runCode("python-compiler", { text: "x" }, signal());
    expect(result.verdict.detail).toMatch(/not installed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["network failure", () => Promise.reject(new TypeError("fetch failed"))],
    ["HTTP 500", async () => json({}, 500)],
    ["HTTP 400", async () => json({ message: "bad" }, 400)],
    ["bad JSON", async () => new Response("<html>", { status: 200 })],
  ])("engine fault is unavailable: %s", async (_n, impl) => {
    fetchMock.mockImplementation(impl);
    const result = await runCode("python-compiler", { text: "x" }, signal());
    expect(result.verdict.level).toBe("warn");
    expect(JSON.stringify(result)).not.toContain("fetch failed");
  });

  test("runtime list is cached for 60 s then refreshed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const count = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/runtimes")).length;
    await runCode("python-compiler", { text: "x" }, signal());
    await runCode("python-compiler", { text: "x" }, signal());
    expect(count()).toBe(1);
    vi.advanceTimersByTime(61_000);
    await runCode("python-compiler", { text: "x" }, signal());
    expect(count()).toBe(2);
  });

  test("caller abort propagates and releases the semaphore", async () => {
    vi.stubEnv("CODE_EXECUTION_MAX_CONCURRENT", "1");
    const controller = new AbortController();
    fetchMock.mockImplementation((url, init) =>
      String(url).endsWith("/runtimes")
        ? Promise.resolve(json(runtimes))
        : new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))),
    );
    const pending = runCode("python-compiler", { text: "x" }, controller.signal);
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/execute"))).toBe(true));
    controller.abort(new Error("client left"));
    await expect(pending).rejects.toThrow("client left");
    fetchMock.mockImplementation(async (url) => (String(url).endsWith("/runtimes") ? json(runtimes) : json(okRun)));
    const next = await runCode("python-compiler", { text: "x" }, signal());
    expect(next.verdict.level).toBe("ok");
  });

  test("a full semaphore answers busy after the 5 s wait", async () => {
    vi.stubEnv("CODE_EXECUTION_MAX_CONCURRENT", "1");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let finish;
    fetchMock.mockImplementation((url) =>
      String(url).endsWith("/runtimes")
        ? Promise.resolve(json(runtimes))
        : new Promise((resolve) => (finish = () => resolve(json(okRun)))),
    );
    const first = runCode("python-compiler", { text: "x" }, signal());
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const second = runCode("python-compiler", { text: "y" }, signal());
    await vi.advanceTimersByTimeAsync(5000);
    expect((await second).verdict.label).toBe("The execution server is busy.");
    finish();
    expect((await first).verdict.level).toBe("ok");
  });

  test("unexpected errors never echo source into the result or logs", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith("/runtimes")) return json(runtimes);
      return {
        ok: true,
        json: async () => {
          throw new Error("TOP-SECRET-SOURCE");
        },
      };
    });
    const result = await runCode("python-compiler", { text: "TOP-SECRET-SOURCE" }, signal());
    expect(result.verdict.level).toBe("warn");
    expect(JSON.stringify(result) + JSON.stringify(spy.mock.calls)).not.toContain("TOP-SECRET-SOURCE");
    spy.mockRestore();
  });
});
