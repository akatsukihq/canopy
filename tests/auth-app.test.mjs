import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";

import {
  DEFAULT_AUTH_ERROR,
  canConfirmAccountDeletion,
  getSafeAuthError,
  isEmailVerificationError,
  isValidPassword,
  normalizeProfileImage,
  resolveReturnTo,
  shouldUseBrowserBack,
} from "../app/auth/_lib/security.ts";

const redirectPolicy = {
  baseURL: "https://smarttools.test",
  fallback: "/",
};

test("profile uses browser history only for the validated return origin", () => {
  const fallback = "/admin";
  const current = "https://smarttools.test/auth/profile";

  expect(shouldUseBrowserBack(fallback, current, "https://smarttools.test/admin/audit", 2)).toBe(true);
  expect(shouldUseBrowserBack(fallback, current, "", 2)).toBe(false);
  expect(shouldUseBrowserBack(fallback, current, "https://untrusted.example/profile-link", 2)).toBe(false);
  expect(shouldUseBrowserBack(fallback, current, "https://smarttools.test/admin/audit", 1)).toBe(false);
  expect(shouldUseBrowserBack(fallback, current, "https://smarttools.test/admin/audit", 2, true)).toBe(false);
});

test("profile photo uses a native image picker instead of a URL field", async () => {
  const source = await readFile(new URL("../app/auth/profile/ProfileManager.tsx", import.meta.url), "utf8");

  expect(source).toMatch(/accept=["']image\/jpeg,image\/png,image\/webp["']/);
  expect(source).toMatch(/type=["']file["']/);
  expect(source).not.toMatch(/type=["']url["']/);
});

test("auth return URLs keep navigation inside the unified application", () => {
  expect(resolveReturnTo("/auth/profile", redirectPolicy)).toBe("/auth/profile");
  expect(resolveReturnTo("/paperwork/invoice-generator", redirectPolicy)).toBe("/paperwork/invoice-generator");
  expect(resolveReturnTo("https://smarttools.test/devtools/json-formatter", redirectPolicy)).toBe(
    "https://smarttools.test/devtools/json-formatter",
  );

  for (const unsafe of [
    "//evil.test",
    "/%2fevil.test",
    "https://smarttools.test.evil.test/",
    "https://user@canopy.test/",
  ]) {
    expect(resolveReturnTo(unsafe, redirectPolicy)).toBe("/");
  }
});

test("auth errors never expose server or provider details", () => {
  const secret = "postgres://admin:password@database.internal";

  expect(getSafeAuthError({ message: secret })).toBe(DEFAULT_AUTH_ERROR);
  expect(getSafeAuthError({ message: secret })).not.toMatch(/postgres|password/);
  expect(getSafeAuthError({ code: "TOO_MANY_REQUESTS" })).toBe("Too many attempts. Try again in a few minutes.");
  expect(isEmailVerificationError({ code: "EMAIL_NOT_VERIFIED" })).toBe(true);
});

test("account inputs enforce password, image, and deletion boundaries", () => {
  expect(isValidPassword("a".repeat(11))).toBe(false);
  expect(isValidPassword("a".repeat(12))).toBe(true);
  expect(isValidPassword("a".repeat(128))).toBe(true);
  expect(isValidPassword("a".repeat(129))).toBe(false);

  expect(normalizeProfileImage("")).toBe(null);
  expect(normalizeProfileImage(" https://images.example/avatar.png ")).toBe("https://images.example/avatar.png");
  expect(() => normalizeProfileImage("javascript:alert(1)")).toThrow();

  expect(canConfirmAccountDeletion(" Person@Example.com ", "person@example.com")).toBe(true);
  expect(canConfirmAccountDeletion("other@example.com", "person@example.com")).toBe(false);
});
