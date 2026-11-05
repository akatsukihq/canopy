import { isRecord } from "../../lib/devtools/shared/json.ts";

type SummaryText = (key: string, values?: Record<string, string | number>) => string;

export type DomainSummary = {
  domain: string;
  age: string;
  ageDetail: string;
  dates: readonly { label: string; value: string; detail?: string }[];
  statuses: readonly { label: string; detail: string }[];
  nameservers: readonly string[];
};

const DAY_MS = 86_400_000;

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  // Registry dates include a timezone. Reject ambiguous or normalized invalid dates.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/i.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, , offsetHour = "0", offsetMinute = "0"] = match;
  const leapYear = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(day) > daysInMonth[Number(month) - 1] ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    Number(offsetHour) > 23 ||
    Number(offsetMinute) > 59
  )
    return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatAge(registered: Date, now: number, text: SummaryText): string {
  const currentYear = new Date(now).getUTCFullYear();
  let years = currentYear - registered.getUTCFullYear();
  const anniversary = new Date(registered);
  anniversary.setUTCFullYear(currentYear);
  // February 29 anniversaries fall on February 28 in non-leap years.
  if (anniversary.getUTCMonth() !== registered.getUTCMonth()) anniversary.setUTCDate(0);
  if (anniversary.getTime() > now) {
    years -= 1;
    anniversary.setUTCFullYear(currentYear - 1, registered.getUTCMonth(), registered.getUTCDate());
    if (anniversary.getUTCMonth() !== registered.getUTCMonth()) anniversary.setUTCDate(0);
  }
  const days = Math.floor((now - anniversary.getTime()) / DAY_MS);
  if (years > 0 && days > 0) return text("workspace.summary.ageYearsDays", { years, days });
  if (years > 0) return text("workspace.summary.ageYears", { years });
  if (days > 0) return text("workspace.summary.ageDays", { days });
  return text("workspace.summary.ageUnderDay");
}

function statusExplanations(text: SummaryText): Record<string, DomainSummary["statuses"][number]> {
  return {
    ok: {
      label: text("workspace.summary.status1"),
      detail: text("workspace.summary.status2"),
    },
    active: {
      label: text("workspace.summary.status1"),
      detail: text("workspace.summary.status2"),
    },
    inactive: {
      label: text("workspace.summary.status3"),
      detail: text("workspace.summary.status4"),
    },
    redemptionperiod: {
      label: text("workspace.summary.status5"),
      detail: text("workspace.summary.status6"),
    },
    pendingdelete: {
      label: text("workspace.summary.status7"),
      detail: text("workspace.summary.status8"),
    },
    pendingrestore: {
      label: text("workspace.summary.status9"),
      detail: text("workspace.summary.status10"),
    },
    pendingcreate: {
      label: text("workspace.summary.status11"),
      detail: text("workspace.summary.status12"),
    },
    pendingrenew: { label: text("workspace.summary.status13"), detail: text("workspace.summary.status14") },
    pendingtransfer: {
      label: text("workspace.summary.status15"),
      detail: text("workspace.summary.status16"),
    },
    pendingupdate: { label: text("workspace.summary.status17"), detail: text("workspace.summary.status18") },
    addperiod: {
      label: text("workspace.summary.status19"),
      detail: text("workspace.summary.status20"),
    },
    autorenewperiod: {
      label: text("workspace.summary.status21"),
      detail: text("workspace.summary.status22"),
    },
    renewperiod: {
      label: text("workspace.summary.status23"),
      detail: text("workspace.summary.status24"),
    },
    transferperiod: {
      label: text("workspace.summary.status25"),
      detail: text("workspace.summary.status26"),
    },
  };
}

function explainStatus(status: string, text: SummaryText): DomainSummary["statuses"][number] {
  const explanations = statusExplanations(text);
  const key = status.toLowerCase().replace(/[\s_-]/g, "");
  if (Object.hasOwn(explanations, key)) return explanations[key];
  const restriction = /^(client|server)(transfer|delete|update|renew)prohibited$/.exec(key);
  if (restriction) {
    const owner = restriction[1] === "client" ? "registrar" : "registry";
    const operation = restriction[2];
    const labels: Record<string, string> = {
      transfer: text("workspace.summary.locked.transfer"),
      delete: text("workspace.summary.locked.delete"),
      update: text("workspace.summary.locked.update"),
      renew: text("workspace.summary.locked.renew"),
    };

    return {
      label: labels[operation],
      detail: text(`workspace.summary.restriction.${owner}.${operation}`),
    };
  }
  if (key === "clienthold" || key === "serverhold") {
    return {
      label: text("workspace.summary.dnsSuspended"),
      detail: text("workspace.summary.dnsSuspendedDetail"),
    };
  }
  const readable = status
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return {
    label: readable.charAt(0).toUpperCase() + readable.slice(1),
    detail: text("workspace.summary.additionalStatus"),
  };
}

export function createDomainSummary(rawJson: string, now: number, text: SummaryText, locale = "en-GB"): DomainSummary {
  const dateFormat = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hourCycle: "h23",
  });
  let record: Record<string, unknown> = {};
  let readableRecord = false;
  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (isRecord(parsed)) {
      record = parsed;
      readableRecord = true;
    }
  } catch {
    /* The preview can still explain an unreadable record. */
  }
  if (!Number.isFinite(new Date(now).getTime())) now = Date.now();

  const registered = parseDate(record.registered);
  let age = text("workspace.summary.ageUnavailable");
  let ageDetail = text("workspace.summary.ageUnreported");
  if (!readableRecord) ageDetail = text("workspace.summary.unreadable");
  else if (!Object.hasOwn(record, "registered")) ageDetail = text("workspace.summary.hiddenDate");
  else if (registered && registered.getTime() > now) ageDetail = text("workspace.summary.futureDate");
  else if (registered) {
    age = formatAge(registered, now, text);
    ageDetail = text("workspace.summary.ageBasis", { date: dateFormat.format(now) });
  }

  const dates: DomainSummary["dates"][number][] = [];
  for (const [key, label] of [
    ["registered", text("workspace.summary.registered")],
    ["expires", text("workspace.summary.expires")],
    ["updated", text("workspace.summary.updated")],
  ] as const) {
    if (!Object.hasOwn(record, key)) continue;
    const date = parseDate(record[key]);
    const value = date
      ? `${dateFormat.format(date)} UTC`
      : record[key] == null || record[key] === ""
        ? text("workspace.summary.notReported")
        : text("workspace.summary.dateUnavailable");
    let detail: string | undefined;
    if (date && key === "expires") {
      const remainingDays = Math.floor((date.getTime() - now) / DAY_MS);
      detail =
        date.getTime() <= now
          ? text("workspace.summary.expired")
          : remainingDays === 0
            ? text("workspace.summary.expiresSoon")
            : text("workspace.summary.daysUntilExpiry", { days: remainingDays });
    }
    dates.push({ label, value, ...(detail ? { detail } : {}) });
  }

  const statusValues = Array.isArray(record.status)
    ? record.status
        .filter((status): status is string => typeof status === "string" && Boolean(status.trim()))
        .map((status) => status.trim())
    : [];
  const uniqueStatuses = [
    ...new Map(statusValues.map((status) => [status.toLowerCase().replace(/[\s_-]/g, ""), status])).values(),
  ];
  const statuses = uniqueStatuses.length
    ? uniqueStatuses.map((status) => explainStatus(status, text))
    : [{ label: text("workspace.summary.notReported"), detail: text("workspace.summary.noStatus") }];
  const nameservers = Array.isArray(record.nameservers)
    ? [
        ...new Set(
          record.nameservers
            .filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
            .map((name) => name.trim()),
        ),
      ]
    : [];

  return {
    domain:
      typeof record.domain === "string" && record.domain.trim()
        ? record.domain.trim()
        : text("workspace.summary.noDomain"),
    age,
    ageDetail,
    dates,
    statuses,
    nameservers,
  };
}
