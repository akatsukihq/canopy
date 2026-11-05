export type LimitUnit = "bytes" | "chars" | "count" | "px";

export const MIB = 1024 * 1024;

/** "100 MiB", "256 KiB", "2,000,000 characters" — what an admin reads beside a limit. */
export function formatLimit(value: number, unit: LimitUnit): string {
  if (unit === "bytes") {
    if (value >= MIB && value % (MIB / 100) === 0) return `${(value / MIB).toLocaleString("en")} MiB`;
    if (value >= 1024 && value % 1024 === 0) return `${(value / 1024).toLocaleString("en")} KiB`;
    return `${value.toLocaleString("en")} bytes`;
  }
  const label = { chars: "characters", count: "", px: "px" }[unit];
  return `${value.toLocaleString("en")}${label ? ` ${label}` : ""}`;
}
