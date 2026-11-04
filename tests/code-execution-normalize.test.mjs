import { describe, expect, test } from "vitest";
import { CODE_LANGUAGES } from "@/lib/code-execution/languages.ts";
import { extractLocation, normalizeExecution, stripAnsi } from "@/lib/code-execution/normalize.ts";
import { toToolResult, CODE_RUN_MESSAGES } from "@/lib/code-execution/result.ts";

const stage = (over = {}) => ({
  stdout: "",
  stderr: "",
  output: "",
  code: 0,
  signal: null,
  message: null,
  status: null,
  cpu_time: 12,
  wall_time: 34,
  memory: 5_242_880,
  ...over,
});
const py = CODE_LANGUAGES["python-compiler"];
const c = CODE_LANGUAGES["c-compiler"];

const cases = [
  ["ok", py, { run: stage({ stdout: "Hello, world!\n", output: "Hello, world!\n" }) }, { status: "ok", exitCode: 0 }],
  [
    "runtime error (RE)",
    py,
    { run: stage({ stderr: "Traceback\n", output: "Traceback\n", code: 1, status: "RE" }) },
    { status: "runtime-error", exitCode: 1 },
  ],
  ["non-zero exit without status", py, { run: stage({ code: 3 }) }, { status: "runtime-error", exitCode: 3 }],
  [
    "signal (SG)",
    c,
    { run: stage({ code: null, signal: "SIGSEGV", status: "SG" }) },
    { status: "killed", signalName: "SIGSEGV" },
  ],
  [
    "signal without status",
    c,
    { run: stage({ code: null, signal: "SIGKILL" }) },
    { status: "killed", signalName: "SIGKILL" },
  ],
  [
    "CPU time limit (TO)",
    py,
    { run: stage({ code: null, signal: "SIGKILL", status: "TO", message: "Time limit exceeded" }) },
    { status: "time-limit", stage: "run", kind: "cpu", limitSeconds: 3 },
  ],
  [
    "wall time limit (TO)",
    py,
    { run: stage({ code: null, signal: "SIGKILL", status: "TO", message: "Time limit exceeded (wall clock)" }) },
    { status: "time-limit", kind: "wall", limitSeconds: 5 },
  ],
  [
    "stdout limit (OL)",
    py,
    { run: stage({ stdout: "x", output: "x", status: "OL", code: null, signal: "SIGKILL" }) },
    { status: "output-limit", stream: "stdout", truncated: true },
  ],
  [
    "stderr limit (EL)",
    py,
    { run: stage({ status: "EL", code: null, signal: "SIGKILL" }) },
    { status: "output-limit", stream: "stderr", truncated: true },
  ],
  ["internal error (XX)", py, { run: stage({ status: "XX" }) }, { status: "unavailable", reason: "engine-error" }],
  [
    "compile failure",
    c,
    {
      compile: stage({
        stderr: "main.c:4:5: error: expected ';' before 'return'\n",
        output: "main.c:4:5: error: expected ';' before 'return'\n",
        code: 1,
      }),
      run: stage({ code: null }),
    },
    {
      status: "compile-error",
      compileOutput: expect.stringContaining("expected ';'"),
      location: { line: 4, column: 5, message: "expected ';' before 'return'" },
    },
  ],
  [
    "compile timeout",
    c,
    { compile: stage({ code: null, signal: "SIGKILL", status: "TO", message: "Time limit exceeded" }), run: stage() },
    { status: "time-limit", stage: "compile", limitSeconds: 10 },
  ],
  [
    "compiled then ran",
    c,
    {
      compile: stage({ output: "warning: unused\n", stderr: "warning: unused\n" }),
      run: stage({ stdout: "hi\n", output: "hi\n" }),
    },
    { status: "ok", compileOutput: "warning: unused\n" },
  ],
  [
    "ANSI stripped",
    py,
    { run: stage({ stderr: "\u001b[31mboom\u001b[0m\n", output: "\u001b[31mboom\u001b[0m\n", code: 1, status: "RE" }) },
    { stderr: "boom\n", output: "boom\n" },
  ],
  [
    "oversized stream truncated",
    py,
    { run: stage({ stdout: "a".repeat(70_000), output: "a".repeat(70_000) }) },
    { truncated: true },
  ],
];

describe("normalizeExecution", () => {
  test.each(cases)("%s", (_name, language, response, expected) => {
    const result = normalizeExecution(language, response);
    expect(result).toMatchObject({ language: language.language, version: language.version, ...expected });
  });

  test("reports units-bearing times and memory", () => {
    const result = normalizeExecution(py, { run: stage() });
    expect(result).toMatchObject({ wallTimeMs: 34, cpuTimeMs: 12, memoryBytes: 5_242_880 });
  });

  test.each([null, "x", {}, { run: "x" }])("rejects malformed response %j", (response) => {
    expect(normalizeExecution(py, response)).toBeNull();
  });
});

describe("extractLocation", () => {
  test.each([
    ["gcc", "main.c:7:12: error: 'x' undeclared (first use in this function)", { line: 7, column: 12 }],
    ["gcc fatal", "main.c:1:10: fatal error: nope.h: No such file or directory", { line: 1, column: 10 }],
    [
      "rustc",
      "error[E0425]: cannot find value `y` in this scope\n --> main.rs:3:20\n  |",
      { line: 3, column: 20, message: "cannot find value `y` in this scope" },
    ],
    [
      "javac",
      "Main.java:5: error: ';' expected\n  int x\n       ^",
      { line: 5, column: null, message: "';' expected" },
    ],
    [
      "tsc",
      "main.ts(9,3): error TS2304: Cannot find name 'foo'.",
      { line: 9, column: 3, message: "Cannot find name 'foo'." },
    ],
    ["csharp", "Program.cs(4,9): error CS1002: ; expected", { line: 4, column: 9 }],
    ["go", "./main.go:6:2: undefined: fmt.Printl", { line: 6, column: 2, message: "undefined: fmt.Printl" }],
    ["kotlin", "Main.kt:2:5: error: unresolved reference: foo", { line: 2, column: 5 }],
    ["ansi-wrapped", "\u001b[1mmain.c:2:3: error: oops\u001b[0m", { line: 2, column: 3 }],
  ])("%s", (_n, output, expected) => {
    expect(extractLocation(output)).toMatchObject(expected);
  });
  test("unrecognised output yields null", () => expect(extractLocation("something odd")).toBeNull());
});

test("stripAnsi removes CSI sequences", () => expect(stripAnsi("\u001b[1;32mok\u001b[0m")).toBe("ok"));

describe("toToolResult", () => {
  test("success leads with a plain sentence and unit-bearing facts", () => {
    const result = toToolResult(
      normalizeExecution(py, { run: stage({ stdout: "a\nb\nc\n", output: "a\nb\nc\n", wall_time: 120 }) }),
    );
    expect(result.verdict).toMatchObject({
      level: "ok",
      label: "Your program ran successfully in 120 ms and printed 3 lines.",
    });
    expect(result).toMatchObject({ render: "text", text: "a\nb\nc\n" });
    expect(result.stats).toContainEqual(expect.objectContaining({ label: "Memory", value: "5.0 MB" }));
  });

  test("compile error names the line and shows compiler output", () => {
    const out = "main.c:4:5: error: expected ';'\n";
    const result = toToolResult(
      normalizeExecution(c, { compile: stage({ stderr: out, output: out, code: 1 }), run: stage({ code: null }) }),
    );
    expect(result.verdict.label).toBe("Compilation failed at line 4: expected ';'");
    expect(result).toMatchObject({ render: "text", text: out });
  });

  test("killed explains the signal", () => {
    const result = toToolResult(normalizeExecution(c, { run: stage({ code: null, signal: "SIGKILL", status: "SG" }) }));
    expect(result.verdict.detail).toMatch(/memory or process limit/);
  });

  test("every referenced message key exists", () => {
    for (const response of [
      { run: stage() },
      { run: stage({ code: 2 }) },
      { run: stage({ status: "SG", signal: "SIGKILL", code: null }) },
      { run: stage({ status: "TO", code: null }) },
      { run: stage({ status: "OL", code: null }) },
      { compile: stage({ code: 1, stderr: "main.c:1:1: error: x" }), run: stage() },
      { compile: stage({ code: 1 }), run: stage() },
    ]) {
      const result = toToolResult(normalizeExecution(c, response));
      for (const ref of [
        result.verdict.labelMessage,
        result.verdict.detailMessage,
        ...result.stats.map((s) => s.labelMessage),
        ...result.sections.map((s) => s.titleMessage),
      ])
        expect(CODE_RUN_MESSAGES).toHaveProperty([ref.key]);
    }
  });
});
