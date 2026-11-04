import { ahrefsApiKey } from "@/lib/config/integrations.ts";
/**
 * Moved verbatim from the inlined `"use server"` action in
 * `app/devtools/[slug]/page.tsx`: the same Ahrefs endpoint, the same
 * validation, the same timeout, the same status handling, the same response
 * shape checks, and the same output lines.
 *
 * `.server` is the point: `node:net` and `AHREFS_API_KEY` live in a bundler
 * context the client and the worker cannot reach. The key is only ever read
 * into a request header — it is never returned, logged, or put in a message.
 */

import { isIP } from "node:net";

import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { DomainRatingResult } from "./result.ts";

type Settings = {};

const AHREFS_DOMAIN_RATING_URL = "https://api.ahrefs.com/v3/public/domain-rating-free";
const MAX_DOMAIN_RATING_TARGET_LENGTH = 2_048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The SSRF gate. Every check here existed before the move and is unchanged in
 * both content and order. It is stricter than `normalizeDomain` in
 * `lib/devtools/shared/url.ts` (which admits IP literals and strips `www.`),
 * so that helper deliberately is not used here — see the migration report.
 */
function normalizeDomainRatingTarget(value: unknown): string {
  if (typeof value !== "string") {
    throw new ToolError("invalid-target", "Enter a domain or HTTP(S) URL.", undefined, {
      messageRef: { key: "errors.targetRequired" },
    });
  }

  const input = value.trim();
  if (!input) {
    throw new ToolError("invalid-target", "Enter a domain or HTTP(S) URL.", undefined, {
      messageRef: { key: "errors.targetRequired" },
    });
  }
  if (input.length > MAX_DOMAIN_RATING_TARGET_LENGTH) {
    throw new ToolError("invalid-target", "Domain or URL must be 2,048 characters or fewer.", undefined, {
      messageRef: { key: "errors.targetTooLong", values: { limit: MAX_DOMAIN_RATING_TARGET_LENGTH } },
    });
  }

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(input);
  const hasHttpScheme = /^https?:\/\//i.test(input);
  if ((hasScheme && !hasHttpScheme) || (!hasHttpScheme && /[/?#]/.test(input))) {
    throw new ToolError("invalid-target", "Enter a valid domain or HTTP(S) URL.", undefined, {
      messageRef: { key: "errors.targetInvalid" },
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(hasHttpScheme ? input : `https://${input}`);
  } catch {
    throw new ToolError("invalid-target", "Enter a valid domain or HTTP(S) URL.", undefined, {
      messageRef: { key: "errors.targetInvalid" },
    });
  }

  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ToolError("invalid-target", "Enter a valid domain or HTTP(S) URL.", undefined, {
      messageRef: { key: "errors.targetInvalid" },
    });
  }

  const domain = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const labels = domain.split(".");
  const validDomain =
    domain.length <= 253 &&
    labels.length >= 2 &&
    isIP(domain) === 0 &&
    labels.every((label) => label.length <= 63 && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label));
  if (!validDomain) {
    throw new ToolError("invalid-target", "Enter a valid public domain.", undefined, {
      messageRef: { key: "errors.publicDomainRequired" },
    });
  }

  return domain;
}

export const run: ToolRun<Settings> = async (ctx): Promise<DomainRatingResult> => {
  const target = normalizeDomainRatingTarget(ctx.input.text);
  ctx.signal.throwIfAborted();
  const endpoint = new URL(AHREFS_DOMAIN_RATING_URL);
  endpoint.search = new URLSearchParams({ target, output: "json" }).toString();
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = await ahrefsApiKey();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      cache: "no-store",
      headers,
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(10_000)]),
    });
  } catch {
    ctx.signal.throwIfAborted();
    throw new ToolError("upstream-unreachable", "Domain Rating Checker could not reach Ahrefs. Try again.", undefined, {
      messageRef: { key: "errors.upstreamUnreachable" },
    });
  }
  ctx.signal.throwIfAborted();
  if (response.status === 401 || response.status === 403) {
    throw new ToolError(
      "upstream-rejected",
      "Ahrefs rejected the request. Check the API key configuration.",
      undefined,
      { messageRef: { key: "errors.upstreamRejected" } },
    );
  }
  if (response.status === 429) {
    throw new ToolError("upstream-rate-limited", "Ahrefs rate limit reached. Try again later.", undefined, {
      messageRef: { key: "errors.upstreamRateLimited" },
    });
  }
  if (!response.ok) {
    throw new ToolError("upstream-failed", `Ahrefs lookup failed (${response.status}).`, undefined, {
      messageRef: { key: "errors.upstreamFailed", values: { status: response.status } },
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    ctx.signal.throwIfAborted();
    throw new ToolError("upstream-invalid", "Ahrefs returned an invalid response.", undefined, {
      messageRef: { key: "errors.upstreamInvalid" },
    });
  }
  ctx.signal.throwIfAborted();
  if (!isRecord(payload) || !isRecord(payload.domain_rating)) {
    throw new ToolError("upstream-invalid", "Ahrefs returned an invalid response.", undefined, {
      messageRef: { key: "errors.upstreamInvalid" },
    });
  }
  const rating = payload.domain_rating.domain_rating;
  const license = payload.domain_rating.license;
  const warning = payload.domain_rating.warning ?? null;
  if (
    typeof rating !== "number" ||
    !Number.isFinite(rating) ||
    rating < 0 ||
    rating > 100 ||
    typeof license !== "string" ||
    !license.trim() ||
    license.length > 1_000 ||
    (warning !== null && typeof warning !== "string") ||
    (typeof warning === "string" && warning.length > 2_000)
  ) {
    throw new ToolError("upstream-invalid", "Ahrefs returned an invalid response.", undefined, {
      messageRef: { key: "errors.upstreamInvalid" },
    });
  }

  return {
    render: "text",
    domainRating: { target, score: rating, license: license.trim(), warning: warning?.trim() || null },
    text: [
      `Target: ${target}`,
      `Domain Rating: ${rating}`,
      "Domain Rating by Ahrefs",
      `License: ${license.trim()}`,
      `Warning: ${warning?.trim() || "None"}`,
    ].join("\n"),
    downloadName: `${target}-domain-rating.txt`,
  };
};

export default run;
