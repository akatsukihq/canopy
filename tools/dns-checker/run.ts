/**
 * Adapted from the `dns-checker` case in `lib/devtools/format-json.ts`:
 * the same `normalizeDomain`, the same closed record-type allowlist, the same
 * DNS-over-HTTPS endpoint and query parameters, the same ten-second timeout,
 * and the same structured/raw output shapes.
 *
 * `run.ts`, not `run.server.ts`: this is a plain `fetch` to a public resolver
 * with no credential, no secret, and no `node:` API. It runs in the browser
 * today and keeping it there preserves the property that the user's query never
 * passes through our servers.
 *
 * The domain is user-supplied and drives an outbound request, so the two guards
 * that bound it — `normalizeDomain` and the six-entry `ALLOWED_TYPES` set — are
 * carried over unchanged and must not be widened.
 */

import { isRecord } from "../../lib/devtools/shared/json.ts";
import { createTablePreview } from "../../lib/devtools/shared/table-preview.ts";
import { normalizeDomain } from "../../lib/devtools/shared/url.ts";
import type { ToolResult, ToolVerdict } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";

export const DNS_RECORD_TYPES = ["A", "AAAA", "MX", "TXT", "NS", "CNAME"] as const;

type Settings = {
  readonly types: string;
  readonly recordView: string;
  readonly recursive: boolean;
  readonly includeTtl: boolean;
  readonly checkDnssec: boolean;
};

const ALLOWED_TYPES = new Set<string>(DNS_RECORD_TYPES);
const LOOKUP_TIMEOUT_MS = 10_000;
const RECORD_TYPE_NAMES: Readonly<Record<number, string>> = {
  1: "A",
  2: "NS",
  5: "CNAME",
  15: "MX",
  16: "TXT",
  28: "AAAA",
};

function answerType(answer: Record<string, unknown>, queriedType: string): string {
  return typeof answer.type === "number" && Number.isInteger(answer.type) && answer.type > 0
    ? (RECORD_TYPE_NAMES[answer.type] ?? `TYPE${answer.type}`)
    : queriedType;
}

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const domain = normalizeDomain(ctx.input.text);
  const types = [
    ...new Set(
      ctx.settings.types
        .split(",")
        .map((type) => type.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (!types.length || types.some((type) => !ALLOWED_TYPES.has(type))) {
    throw new ToolError(
      "record-type-unsupported",
      "DNS record types may only include A, AAAA, MX, TXT, NS, and CNAME.",
      "Select one or more of those six record types.",
      { messageRef: { key: "dns.errors.recordType" }, recoveryMessage: { key: "dns.recovery.recordType" } },
    );
  }
  ctx.signal.throwIfAborted();
  const records = await Promise.all(
    types.map(async (type) => {
      let response: Response;
      try {
        const query = new URLSearchParams({
          name: domain,
          type,
          rd: ctx.settings.recursive ? "1" : "0",
        });
        if (ctx.settings.checkDnssec) {
          query.set("do", "1");
          query.set("cd", "0");
        }
        response = await fetch(`https://dns.google/resolve?${query.toString()}`, {
          headers: { accept: "application/dns-json" },
          signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(LOOKUP_TIMEOUT_MS)]),
        });
      } catch {
        ctx.signal.throwIfAborted();
        throw new ToolError(
          "resolver-unreachable",
          "DNS Checker could not reach the public DNS service.",
          "Check your network connection and try again.",
          { messageRef: { key: "dns.errors.unreachable" }, recoveryMessage: { key: "dns.recovery.network" } },
        );
      }
      ctx.signal.throwIfAborted();
      if (!response.ok) {
        throw new ToolError(
          "lookup-failed",
          `DNS lookup failed (${response.status}).`,
          "The public resolver rejected the query. Try again in a moment.",
          {
            messageRef: { key: "dns.errors.lookup", values: { status: response.status } },
            recoveryMessage: { key: "dns.recovery.lookup" },
          },
        );
      }
      const data: unknown = await response.json();
      if (!isRecord(data)) {
        throw new ToolError("resolver-invalid-response", "DNS service returned an invalid response.", undefined, {
          messageRef: { key: "dns.errors.response" },
        });
      }
      return [type, data] as const;
    }),
  );
  ctx.signal.throwIfAborted();

  const includeTtl = ctx.settings.includeTtl;
  const rows = records.flatMap(([type, data]) => {
    const answers = Array.isArray(data.Answer) ? data.Answer : [];
    return answers.map((answer: unknown) => {
      if (!isRecord(answer)) return `${type}\t—\tInvalid record`;
      const ttl = includeTtl && typeof answer.TTL === "number" ? String(answer.TTL) : "—";
      const value = typeof answer.data === "string" ? answer.data : JSON.stringify(answer.data ?? "");
      return `${answerType(answer, type)}\t${ttl}\t${value}`;
    });
  });

  const preview = createTablePreview(["Type", "Name", "Value", ...(includeTtl ? ["TTL (seconds)"] : [])]);
  const seen = new Set<string>();
  let hasWarning = false;
  let failedLookups = 0;
  let notFoundLookups = 0;
  const statusMessages: ({ key: string; values?: Record<string, string | number> } | undefined)[][] = [];
  function statusRow(
    type: string,
    status: string,
    detail: string,
    statusKey: string,
    detailKey: string,
    values?: Record<string, string | number>,
  ) {
    statusMessages.push([undefined, { key: `dns.status.${statusKey}` }, { key: `dns.details.${detailKey}`, values }]);
    return [type, status, detail];
  }
  const statusRows = records.map(([type, data]) => {
    const answers = Array.isArray(data.Answer) ? data.Answer : [];
    let invalidAnswers = data.Answer !== undefined && !Array.isArray(data.Answer);
    let answerCount = 0;
    for (const answer of answers) {
      if (!isRecord(answer) || answer.data === undefined || answer.data === null) {
        invalidAnswers = true;
        continue;
      }
      if (
        answer.type !== undefined &&
        (typeof answer.type !== "number" || !Number.isInteger(answer.type) || answer.type <= 0 || answer.type > 65535)
      ) {
        invalidAnswers = true;
        continue;
      }
      const actualType = answerType(answer, type);
      const name = typeof answer.name === "string" && answer.name ? answer.name : domain;
      const value = typeof answer.data === "string" ? answer.data : JSON.stringify(answer.data);
      const ttl =
        typeof answer.TTL === "number" && Number.isFinite(answer.TTL) && answer.TTL >= 0 ? String(answer.TTL) : "—";
      answerCount += 1;
      const key = JSON.stringify([actualType, name.toLowerCase().replace(/\.$/, ""), value]);
      if (seen.has(key)) continue;
      seen.add(key);
      preview.append([actualType, name, value, ...(includeTtl ? [ttl] : [])]);
    }

    const status =
      typeof data.Status === "number" && Number.isInteger(data.Status) && data.Status >= 0
        ? data.Status
        : data.Status === undefined && Array.isArray(data.Answer)
          ? 0
          : null;
    if (status === 3) {
      hasWarning = true;
      notFoundLookups += 1;
      return statusRow(
        type,
        "Domain not found",
        "The resolver reports that this name does not exist (DNS status 3, NXDOMAIN). Check the spelling.",
        "notFound",
        "notFound",
      );
    }
    if (status !== null && status !== 0) {
      hasWarning = true;
      failedLookups += 1;
      const reason =
        status === 2 ? "could not complete the lookup" : status === 5 ? "refused the lookup" : "returned an error";
      return statusRow(
        type,
        "Resolver failed",
        `The resolver ${reason} (DNS status ${status}). Try again; this does not mean the domain has no records.`,
        "failed",
        "failed",
        { status },
      );
    }
    if (status === null || (invalidAnswers && answerCount === 0)) {
      hasWarning = true;
      failedLookups += 1;
      return statusRow(
        type,
        "Invalid response",
        "The resolver response could not be read reliably. Try again or inspect the raw response.",
        "invalid",
        "invalid",
      );
    }
    if (data.TC === true || invalidAnswers) {
      hasWarning = true;
      return statusRow(
        type,
        "Incomplete response",
        data.TC === true
          ? `The resolver truncated its response; ${answerCount} readable answers are shown. Try again or inspect the raw response.`
          : `${answerCount} readable answers are shown; invalid answer entries were skipped. Try again or inspect the raw response.`,
        "incomplete",
        data.TC === true ? "truncated" : "skipped",
        { count: answerCount },
      );
    }
    return answerCount
      ? statusRow(
          type,
          "Records returned",
          `${answerCount} answer${answerCount === 1 ? "" : "s"} returned. Aliases may appear under their actual record type.`,
          "returned",
          "returned",
          { count: answerCount },
        )
      : statusRow(
          type,
          "No records",
          `The resolver returned no ${type} answers. This alone does not indicate a problem with the domain.`,
          "none",
          "none",
          { type },
        );
  });

  const recordCount = `${seen.size} DNS record${seen.size === 1 ? "" : "s"}`;
  const lookupFailed = failedLookups === records.length && seen.size === 0;
  const verdict: ToolVerdict =
    notFoundLookups === records.length && seen.size === 0
      ? {
          level: "warn",
          label: `Domain not found: ${domain}`,
          labelMessage: { key: "dns.verdict.notFound", values: { domain } },
          detail: "The public resolver could not find this name. Check the domain spelling and try again.",
          detailMessage: { key: "dns.verdict.notFoundDetail" },
        }
      : hasWarning
        ? {
            level: lookupFailed ? "error" : "warn",
            label: `DNS lookup ${lookupFailed ? "failed" : "warning"} for ${domain}`,
            labelMessage: { key: lookupFailed ? "dns.verdict.failed" : "dns.verdict.warning", values: { domain } },
            detail: `${recordCount} returned. Some lookups were unsuccessful or incomplete; see the affected rows before relying on these results.`,
            detailMessage: { key: "dns.verdict.warningDetail", values: { count: seen.size } },
          }
        : seen.size
          ? {
              level: "ok",
              label: `${recordCount} found for ${domain}`,
              labelMessage: { key: "dns.verdict.found", values: { count: seen.size, domain } },
              detail: `Queried ${types.join(", ")}. Repeated answers are shown once.`,
              detailMessage: { key: "dns.verdict.foundDetail", values: { types: types.join(", ") } },
            }
          : {
              level: "ok",
              label: `No DNS records found for ${domain}`,
              labelMessage: { key: "dns.verdict.none", values: { domain } },
              detail: `The resolver returned no answers for ${types.join(", ")}. Try another record type or verify the domain name.`,
              detailMessage: { key: "dns.verdict.noneDetail", values: { types: types.join(", ") } },
            };
  const raw = ctx.settings.recordView === "raw";

  return {
    render: "text",
    text: raw
      ? JSON.stringify(Object.fromEntries(records), null, 2)
      : rows.length
        ? rows.join("\n")
        : "NO_RECORDS\t—\tNo matching DNS records",
    downloadName: raw ? "dns-records.json" : "dns-records.txt",
    tablePreview: preview.result
      ? {
          ...preview.result,
          columnMessages: ["type", "name", "value", ...(includeTtl ? ["ttlSeconds"] : [])].map((key) => ({
            key: `dns.${key}`,
          })),
        }
      : undefined,
    verdict,
    sections: [
      {
        title: "Lookup status",
        titleMessage: { key: "dns.lookupStatus" },
        body: {
          render: "table",
          columns: ["Type", "Status", "Details"],
          columnMessages: ["type", "columnStatus", "columnDetails"].map((key) => ({ key: `dns.${key}` })),
          rows: statusRows,
          rowMessages: statusMessages,
        },
      },
    ],
  };
};

export default run;
