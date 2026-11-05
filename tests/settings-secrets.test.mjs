import { afterEach, expect, test } from "vitest";
import { decryptSecret, encryptSecret, secretsAvailable } from "../lib/config/secrets.ts";
import { missingProviderSettings, resolveRuntimeSettings } from "../lib/config/runtimeSettings.ts";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

const KEY = "k".repeat(40);

test("a saved secret decrypts only for its own setting and with the same server key", () => {
  process.env.SETTINGS_ENCRYPTION_KEY = KEY;
  const stored = encryptSecret("sk-test-123", "ai.openai.apiKey");
  expect(JSON.stringify(stored)).not.toContain("sk-test-123");
  expect(decryptSecret(stored, "ai.openai.apiKey")).toBe("sk-test-123");
  expect(decryptSecret(stored, "ai.anthropic.apiKey")).toBeNull();
  process.env.SETTINGS_ENCRYPTION_KEY = "z".repeat(40);
  expect(decryptSecret(stored, "ai.openai.apiKey")).toBeNull();
});

test("without a long enough server key, secrets cannot be saved", () => {
  process.env.SETTINGS_ENCRYPTION_KEY = "short";
  expect(secretsAvailable()).toBe(false);
  expect(() => encryptSecret("x", "ai.openai.apiKey")).toThrow(/SETTINGS_ENCRYPTION_KEY/);
});

test("a stored key overrides env, and a provider is ready only when all its settings have values", () => {
  process.env.SETTINGS_ENCRYPTION_KEY = KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const empty = resolveRuntimeSettings(new Map());
  expect(missingProviderSettings(empty, "ai.provider", "anthropic")).toEqual(["ai.anthropic.apiKey"]);

  const stored = encryptSecret("sk-ant-1", "ai.anthropic.apiKey");
  const settings = resolveRuntimeSettings(new Map([["ai.anthropic.apiKey", stored]]));
  expect(settings["ai.anthropic.apiKey"]).toMatchObject({ value: "sk-ant-1", source: "admin" });
  expect(missingProviderSettings(settings, "ai.provider", "anthropic")).toEqual([]);
});
