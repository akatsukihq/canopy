import { test, expect } from "vitest";
import { errorMessage } from "../utils/errorMessage.ts";

test("response errors preserve original messages without stack traces", () => {
  for (const error of [
    new Error("Storage is unavailable"),
    { message: " Storage is unavailable " },
    "Storage is unavailable",
  ]) {
    expect(errorMessage(error, "Try again")).toBe("Storage is unavailable");
  }
  expect(errorMessage(new Error("Connection refused\n    at upload (/private/app.ts:4:2)"), "Try again")).toBe(
    "Connection refused",
  );
});

test("missing messages use the supplied fallback", () => {
  for (const error of [undefined, null, 42, {}, { message: 42 }, new Error("  "), ""]) {
    expect(errorMessage(error, "Try again")).toBe("Try again");
  }
});

test("sensitive values are hidden while the rest of the message is preserved", () => {
  for (const [original, expected] of [
    [
      "Failed query: insert into customers values ($1)\nparams: private-data",
      "Failed query: [hidden]\nparams: [hidden]",
    ],
    ["Connection failed: postgres://user:password@database", "Connection failed: [hidden]"],
    ["Connection failed: postgres://private-password", "Connection failed: [hidden]"],
    ["Upload rejected https://user:password@example.test/path", "Upload rejected [hidden]"],
    ["Invalid password=private-value; retry", "Invalid password=[hidden]; retry"],
    ['Invalid "api_key": "private value"', 'Invalid "api_key": [hidden]'],
    ["Invalid Authorization: Bearer private-value", "Invalid Authorization: [hidden]"],
    ["Invalid Bearer private-value", "Invalid Bearer [hidden]"],
  ]) {
    expect(errorMessage(new Error(original), "Try again")).toBe(expected);
  }
  expect(
    errorMessage(new Error("Failed query: select 1 from postgres://u:p@db\nparams: 7"), "x", { showSql: true }),
  ).toBe("Failed query: select 1 from [hidden]\nparams: 7");
  for (const name of ["api_secret", "access_token", "refreshToken", "clientSecret"]) {
    expect(errorMessage(new Error(`Rejected ${name}=private-value; retry`), "Try again")).toBe(
      `Rejected ${name}=[hidden]; retry`,
    );
  }
});
