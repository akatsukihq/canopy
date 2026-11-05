import { createHash, timingSafeEqual } from "node:crypto";
import { errorMessage } from "../../utils/errorMessage.ts";

type PublishCounts = { attempted: number; published: number; failed: number; remaining: number };

const TOKEN_PATTERN = /^[A-Za-z0-9._~+/-]+=*$/;
const validSecret = (value: string | undefined): value is string =>
  Boolean(value && value.length <= 1024 && TOKEN_PATTERN.test(value));

function publishCounts(value: unknown): PublishCounts {
  if (!value || typeof value !== "object") throw new Error("Blog publishing returned an invalid response.");
  const result = value as Record<string, unknown>;
  for (const key of ["attempted", "published", "failed", "remaining"]) {
    if (!Number.isSafeInteger(result[key]) || (result[key] as number) < 0) {
      throw new Error("Blog publishing returned an invalid response.");
    }
  }
  return {
    attempted: result.attempted as number,
    published: result.published as number,
    failed: result.failed as number,
    remaining: result.remaining as number,
  };
}

export async function handleBlogPublishRequest(
  request: Request,
  secret: string | undefined,
  publish: () => Promise<PublishCounts>,
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: { ...headers, Allow: "POST" } });
  }
  if (!validSecret(secret)) {
    return Response.json({ error: "Blog publishing is not configured." }, { status: 503, headers });
  }
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.length <= 1031 ? /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(authorization)?.[1] : undefined;
  if (
    !token ||
    !timingSafeEqual(createHash("sha256").update(token).digest(), createHash("sha256").update(secret).digest())
  ) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers });
  }
  try {
    return Response.json(publishCounts(await publish()), { headers });
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, "Blog publishing is temporarily unavailable.") },
      { status: 503, headers },
    );
  }
}
