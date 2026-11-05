import { expect, test } from "vitest";
import { handleAssistantMaintenanceRequest } from "../lib/assistant/cron.ts";

const secret = "test-assistant-scheduler-secret-for-tests";
const path = "/api/internal/assistant/maintenance";
const counts = { files: 3, runs: 2, failed: 1 };
const request = (authorization, method = "POST") =>
  new Request(`https://smarttools.test${path}`, {
    method,
    headers: authorization ? { authorization } : {},
  });

test("maintenance authenticates before invoking domain logic and returns only safe counts", async () => {
  let calls = 0;
  const cleanup = async () => {
    calls++;
    return { ...counts, privateError: "database-password" };
  };
  for (const authorization of [
    undefined,
    "Basic example",
    "Bearer wrong",
    `Bearer ${secret}, extra`,
    `Bearer ${secret} extra`,
  ]) {
    const response = await handleAssistantMaintenanceRequest(request(authorization), secret, cleanup);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  for (const configured of [undefined, "", "   ", "secret with spaces"]) {
    const response = await handleAssistantMaintenanceRequest(request(`Bearer ${secret}`), configured, cleanup);
    expect(response.status).toBe(503);
  }
  expect(calls).toBe(0);
  const response = await handleAssistantMaintenanceRequest(request(`bearer ${secret}`), secret, cleanup);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(counts);
  expect(calls).toBe(1);
});

test("GET cannot clean up and failed domain requests never expose internal error details", async () => {
  let calls = 0;
  const cleanup = async () => {
    calls++;
    throw new Error("postgres://private-password@database");
  };
  const get = await handleAssistantMaintenanceRequest(request(`Bearer ${secret}`, "GET"), secret, cleanup);
  expect(get.status).toBe(405);
  expect(get.headers.get("allow")).toBe("POST");
  expect(calls).toBe(0);
  const failed = await handleAssistantMaintenanceRequest(request(`Bearer ${secret}`), secret, cleanup);
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ error: "[hidden]" });
  expect(calls).toBe(1);
});

test("maintenance returns the original failure message with a default for empty errors", async () => {
  for (const [error, expected] of [
    [new Error("Publishing connection timed out"), "Publishing connection timed out"],
    [new Error(""), "Assistant maintenance is temporarily unavailable."],
  ]) {
    const response = await handleAssistantMaintenanceRequest(request(`Bearer ${secret}`), secret, async () => {
      throw error;
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: expected });
  }
});
