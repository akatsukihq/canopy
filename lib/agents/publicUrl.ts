/** Server-only SSRF guard shared by MCP servers and custom HTTP tools. */
import "server-only";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

// Loopback, private, link-local (incl. cloud metadata 169.254.169.254 / fd00:ec2::254), CGNAT (incl.
// 100.100.100.200), multicast, reserved and every IPv6 form that embeds an IPv4 address.
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  BLOCKED.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  // IPv4-mapped (::ffff:a.b.c.d) addresses are checked against the IPv4 rules above by BlockList itself.
  ["::", 96], // unspecified, ::1 and IPv4-compatible
  ["64:ff9b::", 96], // NAT64
  ["2002::", 16], // 6to4
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10], // deprecated site-local
  ["100::", 64], // discard-only
  ["2001::", 32], // Teredo
  ["ff00::", 8],
] as const)
  BLOCKED.addSubnet(net, prefix, "ipv6");

const MESSAGES = {
  invalid: "Enter a valid URL.",
  private: "The address must be a public HTTPS address.",
  credentials: "Do not put credentials in the URL.",
  unresolved: "The host could not be resolved.",
} as const;

/** The URL is not an allowed public https destination. Messages are fixed and safe to show admins. */
export class BlockedUrlError extends Error {
  override name = "BlockedUrlError";
  readonly reason: keyof typeof MESSAGES;
  constructor(reason: keyof typeof MESSAGES) {
    super(MESSAGES[reason]);
    this.reason = reason;
  }
}

/** Throws BlockedUrlError unless the URL is https and every address its host resolves to is public. */
export async function assertPublicHttpsUrl(url: string | URL): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BlockedUrlError("invalid");
  }
  if (parsed.protocol !== "https:") throw new BlockedUrlError("private");
  if (parsed.username || parsed.password) throw new BlockedUrlError("credentials");
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  let addresses: { address: string; family: number }[];
  try {
    addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new BlockedUrlError("unresolved");
  }
  if (
    !addresses.length ||
    addresses.some(({ address, family }) => BLOCKED.check(address, family === 6 ? "ipv6" : "ipv4"))
  )
    throw new BlockedUrlError("private");
  return parsed;
}
