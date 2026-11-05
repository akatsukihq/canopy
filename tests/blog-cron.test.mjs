import { expect, test } from "vitest";
import { handleBlogPublishRequest } from "@/lib/blog/cron.ts";

const secret = "test-blog-scheduler-secret-for-tests";
const path = "/api/internal/blog/publish-due";
const counts = { attempted: 3, published: 2, failed: 1, remaining: 4 };
const request = (authorization, method = "POST") =>
  new Request(`https://smarttools.test${path}`, {
    method,
    headers: authorization ? { authorization } : {},
  });

test("publishing authenticates before invoking domain logic and returns only safe counts", async () => {
  let calls = 0;
  const publish = async () => {
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
    const response = await handleBlogPublishRequest(request(authorization), secret, publish);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  for (const configured of [undefined, "", "   ", "secret with spaces"]) {
    const response = await handleBlogPublishRequest(request(`Bearer ${secret}`), configured, publish);
    expect(response.status).toBe(503);
  }
  expect(calls).toBe(0);
  const response = await handleBlogPublishRequest(request(`bearer ${secret}`), secret, publish);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(counts);
  expect(calls).toBe(1);
});

test("GET cannot publish and failed domain requests never expose internal error details", async () => {
  let calls = 0;
  const publish = async () => {
    calls++;
    throw new Error("postgres://private-password@database");
  };
  const get = await handleBlogPublishRequest(request(`Bearer ${secret}`, "GET"), secret, publish);
  expect(get.status).toBe(405);
  expect(get.headers.get("allow")).toBe("POST");
  expect(calls).toBe(0);
  const failed = await handleBlogPublishRequest(request(`Bearer ${secret}`), secret, publish);
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ error: "[hidden]" });
  expect(calls).toBe(1);
});

test("publishing returns the original failure message with a default for empty errors", async () => {
  for (const [error, expected] of [
    [new Error("Publishing connection timed out"), "Publishing connection timed out"],
    [new Error(""), "Blog publishing is temporarily unavailable."],
  ]) {
    const response = await handleBlogPublishRequest(request(`Bearer ${secret}`), secret, async () => {
      throw error;
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: expected });
  }
});
