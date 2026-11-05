import { toolSpec } from "../../tests/helpers/toolSpec.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { parseSettings } from "../../lib/tool-framework/settings.ts";
const definition = await toolSpec("basic-auth-generator");
import { run } from "./run.ts";

const context = (username = "Ada", password = "secret", settings = {}) => ({
  input: { text: username, secondary: password, files: [] },
  settings: parseSettings(definition.settings, settings),
  signal: new AbortController().signal,
});

const languages = { header: "http", value: "plaintext", base64: "plaintext", curl: "bash", fetch: "javascript" };
const fixtures = JSON.parse(await readFile(new URL("./fixtures.json", import.meta.url), "utf8"));

for (const example of fixtures.cases) {
  test(`basic auth generates exact ${example.name}`, () => {
    const result = run(context(example.input.primary, example.input.secondary, example.settings));
    assert.equal(result.render, example.expected.render);
    assert.equal(result.text, example.expected.output);
    assert.equal(result.language, languages[example.settings.format]);
  });
}

test("basic auth defaults to the complete Authorization header", () => {
  const result = run(context());
  assert.equal(result.text, "Authorization: Basic QWRhOnNlY3JldA==");
  assert.equal(result.language, "http");
});

for (const [name, username, password] of [
  ["UTF-8 credentials", "é用户", "päss🔐"],
  ["empty password with its trailing colon", "Ada", ""],
  ["surrounding spaces", " Ada ", " secret "],
  ["password colons", "Ada", "se:cret:with:colons"],
]) {
  test(`basic auth preserves ${name}`, () => {
    const result = run(context(username, password, { format: "base64" }));
    const credentials = `${username}:${password}`;
    assert.equal(result.text, Buffer.from(credentials, "utf8").toString("base64"));
    assert.equal(Buffer.from(result.text, "base64").toString("utf8"), credentials);
  });
}

test("basic auth treats an omitted password as empty", () => {
  const ctx = context("Ada", "", { format: "base64" });
  delete ctx.input.secondary;
  assert.equal(run(ctx).text, "QWRhOg==");
});

function assertCredentialError(username, password, code) {
  assert.throws(
    () => run(context(username, password)),
    (error) => {
      assert.equal(error.code, code);
      const message = [error.message, error.recovery, error.stack].filter(Boolean).join("\n");
      assert.ok(!message.includes("test-user-secret"), "Errors must not expose the username");
      assert.ok(!message.includes("test-password-secret"), "Errors must not expose the password");
      assert.ok(!message.includes(Buffer.from(`${username}:${password}`, "utf8").toString("base64")));
      return true;
    },
  );
}

test("basic auth rejects a colon in the username without exposing credentials", () => {
  assertCredentialError("test-user-secret:tail", "test-password-secret", "invalid-username");
});

test("basic auth rejects every C0 and DEL control character in either credential", () => {
  for (const codePoint of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
    const control = String.fromCharCode(codePoint);
    assertCredentialError(`test-user-secret${control}`, "test-password-secret", "invalid-credentials");
    assertCredentialError("test-user-secret", `test-password-secret${control}`, "invalid-credentials");
  }
});

test("basic auth identifies control-only usernames as invalid credentials", () => {
  for (const username of ["\t", "\n", "\r"]) {
    assertCredentialError(username, "test-password-secret", "invalid-credentials");
  }
});

test("basic auth still requires a username", () => {
  assertCredentialError("", "test-password-secret", "input-required");
});
