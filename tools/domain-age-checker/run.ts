/**
 * Moved verbatim from the `domain-age-checker` case in
 * `lib/devtools/format-json.ts`: the same `normalizeDomain`, the same RDAP
 * bootstrap endpoint with the same `encodeURIComponent` on the path segment,
 * the same accept header, the same ten-second timeout, the same event lookups,
 * and the same JSON output shape and key order.
 *
 * `run.ts`, not `run.server.ts`: this is a plain `fetch` to a public RDAP
 * service with no credential, no secret, and no `node:` API. It runs in the
 * browser today and keeping it there preserves the property that the user's
 * queried domain never passes through our servers.
 *
 * The domain is user-supplied and drives an outbound request, so the guard that
 * bounds it — `normalizeDomain`, which rejects anything that is not a
 * dot-bearing `[a-z0-9.-]` hostname — is carried over unchanged and must not be
 * widened. The normalized hostname is the only thing interpolated into the URL,
 * and it is percent-encoded on the way in.
 */

import { isRecord } from "../../lib/devtools/shared/json.ts";
import { normalizeDomain } from "../../lib/devtools/shared/url.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";

type Settings = {
  readonly showRegistrationDate: boolean;
  readonly showExpiryDate: boolean;
};

const LOOKUP_TIMEOUT_MS = 10_000;

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  let domain: string;
  try {
    domain = normalizeDomain(ctx.input.text);
  } catch (error) {
    if (!(error instanceof ToolError)) throw error;
    throw new ToolError(error.code, error.message, error.recovery, {
      messageRef: { key: `errors.${error.code}` },
      ...(error.recovery ? { recoveryMessage: { key: "errors.enterValue" } } : {}),
    });
  }
  ctx.signal.throwIfAborted();

  let response: Response;
  try {
    response = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { accept: "application/rdap+json, application/json" },
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(LOOKUP_TIMEOUT_MS)]),
    });
  } catch {
    ctx.signal.throwIfAborted();
    throw new ToolError(
      "rdap-unreachable",
      "Domain Age Checker could not reach the public RDAP service.",
      "Check your network connection and try again.",
      { messageRef: { key: "errors.rdapUnreachable" }, recoveryMessage: { key: "errors.checkNetwork" } },
    );
  }
  ctx.signal.throwIfAborted();
  if (!response.ok) {
    throw new ToolError(
      "lookup-failed",
      `RDAP lookup failed (${response.status}).`,
      "Many country-code TLDs publish no RDAP endpoint. Try a gTLD such as .com.",
      {
        messageRef: { key: "errors.lookupFailed", values: { status: response.status } },
        recoveryMessage: { key: "errors.trySupportedTld" },
      },
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    ctx.signal.throwIfAborted();
    throw new ToolError("rdap-invalid-response", "RDAP service returned an invalid response.", undefined, {
      messageRef: { key: "errors.rdapInvalidResponse" },
    });
  }
  ctx.signal.throwIfAborted();
  if (!isRecord(data)) {
    throw new ToolError("rdap-invalid-response", "RDAP service returned an invalid response.", undefined, {
      messageRef: { key: "errors.rdapInvalidResponse" },
    });
  }

  const events = Array.isArray(data.events) ? data.events.filter(isRecord) : [];
  const event = (action: string): unknown =>
    events.find((candidate) => candidate.eventAction === action)?.eventDate ?? null;

  const record = {
    domain: data.ldhName ?? domain,
    ...((ctx.settings.showRegistrationDate ?? true) ? { registered: event("registration") } : {}),
    ...((ctx.settings.showExpiryDate ?? true) ? { expires: event("expiration") } : {}),
    updated: event("last changed"),
    status: data.status ?? [],
    nameservers: Array.isArray(data.nameservers)
      ? data.nameservers.flatMap((server: unknown) =>
          isRecord(server) && typeof server.ldhName === "string" ? [server.ldhName] : [],
        )
      : [],
  };

  return {
    render: "text",
    text: JSON.stringify(record, null, 2),
    downloadName: "domain-registration.json",
  };
};

export default run;
