/**
 * Inspect unverified JWT timing claims locally. Raw output remains compatible;
 * the structured summary adds a checked-at snapshot and the not-before claim.
 * Decoded payload content is included only when explicitly requested.
 */

import { decodeJwt } from "../../lib/devtools/shared/jwt.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import { isNumericDate, type JwtExpirationResult, type JwtExpirationSummary } from "./result.ts";

type Settings = {
  readonly useLocalTime: boolean;
  readonly decodePayload: boolean;
  readonly warnBeforeExpiry: boolean;
};

export const run: ToolRun<Settings> = (ctx): JwtExpirationResult => {
  const { payload } = decodeJwt(ctx.input.text);
  const now = Date.now() / 1000;
  const claimDate = (claim: "exp" | "nbf" | "iat"): number | null => {
    if (!Object.hasOwn(payload, claim)) return null;
    const value = payload[claim];
    if (!isNumericDate(value)) {
      throw new ToolError(
        "invalid-numeric-date",
        `JWT ${claim} must be a finite NumericDate in seconds within the supported date range.`,
        `Check the ${claim} claim in the token input. Use a JSON number of seconds since 1970-01-01 UTC, not a date string.`,
        {
          messageRef: { key: "execution.errors.numericDate", values: { claim } },
          recoveryMessage: { key: "execution.recovery.numericDate", values: { claim } },
        },
      );
    }
    return value;
  };
  const expiration = claimDate("exp");
  const notBefore = claimDate("nbf");
  const issuedAt = claimDate("iat");
  const formatDate = (seconds: number) =>
    ctx.settings.useLocalTime === true
      ? new Date(seconds * 1000).toLocaleString()
      : new Date(seconds * 1000).toISOString();
  const state: JwtExpirationSummary["state"] =
    expiration !== null && expiration <= now
      ? "expired"
      : notBefore !== null && notBefore > now
        ? "not-active"
        : expiration === null
          ? "no-expiration"
          : ctx.settings.warnBeforeExpiry === true && expiration <= now + 300
            ? "expiring-soon"
            : "active";
  const stateLabels = {
    active: "Active",
    expired: "Expired",
    "not-active": "Not active yet",
    "expiring-soon": "Expiring soon",
    "no-expiration": "No expiration claim",
  };
  const lines = [
    `Status: ${stateLabels[state]}`,
    expiration === null ? "Expires: not specified" : `Expires: ${formatDate(expiration)}`,
    issuedAt === null ? "Issued: not specified" : `Issued: ${formatDate(issuedAt)}`,
  ];
  if (ctx.settings.decodePayload === true) {
    lines.push("Payload:", JSON.stringify(payload, null, 2));
  }
  return {
    render: "text",
    text: lines.join("\n"),
    jsonPreview: {
      render: "json-tree",
      value: {
        state,
        checkedAt: now,
        expiresAt: expiration,
        issuedAt,
        notBefore,
        useLocalTime: ctx.settings.useLocalTime === true,
        ...(ctx.settings.decodePayload === true ? { payload } : {}),
      },
    },
  };
};

export default run;
