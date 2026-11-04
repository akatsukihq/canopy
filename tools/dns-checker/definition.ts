import { INPUT_EXECUTION_MESSAGES, URL_EXECUTION_MESSAGES } from "../../lib/devtools/shared/execution-messages.ts";
import type { ToolSpec } from "../../lib/tool-framework/spec";

/**
 * `slug` is declared because `slugFromName("DNS & Email Records Checker")` is
 * `dns-and-email-records-checker`, which does not match the folder name. The
 * folder name is the live indexed URL and must not move.
 */
export default {
  messages: {
    ...INPUT_EXECUTION_MESSAGES,
    ...URL_EXECUTION_MESSAGES,
    "dns.type": "Type",
    "dns.name": "Name",
    "dns.value": "Value",
    "dns.ttlSeconds": "TTL (seconds)",
    "dns.lookupStatus": "Lookup status",
    "dns.columnStatus": "Status",
    "dns.columnDetails": "Details",
    "dns.status.notFound": "Domain not found",
    "dns.status.failed": "Resolver failed",
    "dns.status.invalid": "Invalid response",
    "dns.status.incomplete": "Incomplete response",
    "dns.status.returned": "Records returned",
    "dns.status.none": "No records",
    "dns.details.notFound":
      "The resolver reports that this name does not exist (DNS status 3, NXDOMAIN). Check the spelling.",
    "dns.details.failed":
      "The resolver {status, select, 2 {could not complete the lookup} 5 {refused the lookup} other {returned an error}} (DNS status {status}). Try again; this does not mean the domain has no records.",
    "dns.details.invalid": "The resolver response could not be read reliably. Try again or inspect the raw response.",
    "dns.details.truncated":
      "The resolver truncated its response; {count, number} readable answers are shown. Try again or inspect the raw response.",
    "dns.details.skipped":
      "{count, number} readable answers are shown; invalid answer entries were skipped. Try again or inspect the raw response.",
    "dns.details.returned":
      "{count, plural, one {# answer returned.} other {# answers returned.}} Aliases may appear under their actual record type.",
    "dns.details.none":
      "The resolver returned no {type} answers. This alone does not indicate a problem with the domain.",
    "dns.verdict.notFound": "Domain not found: {domain}",
    "dns.verdict.notFoundDetail":
      "The public resolver could not find this name. Check the domain spelling and try again.",
    "dns.verdict.failed": "DNS lookup failed for {domain}",
    "dns.verdict.warning": "DNS lookup warning for {domain}",
    "dns.verdict.warningDetail":
      "{count, plural, one {# DNS record returned.} other {# DNS records returned.}} Some lookups were unsuccessful or incomplete; see the affected rows before relying on these results.",
    "dns.verdict.found": "{count, plural, one {# DNS record found} other {# DNS records found}} for {domain}",
    "dns.verdict.foundDetail": "Queried {types}. Repeated answers are shown once.",
    "dns.verdict.none": "No DNS records found for {domain}",
    "dns.verdict.noneDetail":
      "The resolver returned no answers for {types}. Try another record type or verify the domain name.",
    "dns.errors.recordType": "DNS record types may only include A, AAAA, MX, TXT, NS, and CNAME.",
    "dns.recovery.recordType": "Select one or more of those six record types.",
    "dns.errors.unreachable": "DNS Checker could not reach the public DNS service.",
    "dns.recovery.network": "Check your network connection and try again.",
    "dns.errors.lookup": "DNS lookup failed ({status}).",
    "dns.recovery.lookup": "The public resolver rejected the query. Try again in a moment.",
    "dns.errors.response": "DNS service returned an invalid response.",
    "workspace.dns_records_00ce58": "DNS records",
    "workspace.type_baaddf": "Type",
    "workspace.explanation_16ee46": "Explanation",
    "workspace.record_value_f7b42a": "Record value",
    "workspace.cache_time_72f91b": "Cache time",
    "workspace.copy_value_c019c0": "Copy value",
    "workspace.empty_value_19ad22": "Empty value",
    "workspace.for_98502e": "For ",
    "workspace.this_domain_declares_30129b": "This domain declares that it does not accept email.",
    "workspace.the_first_number_5715af": "The first number is priority; lower numbers are preferred.",
    "workspace.not_supplied_8b427d": "Not supplied",
    "workspace.showing_part_of_3b2915": "Showing part of the records. Download the complete output for all answers.",
    "workspace.a_missing_record_20741a": "A missing record type does not by itself indicate a problem with the domain.",
    "workspace.ttl_is_the_3d47e3": "TTL is the resolver’s remaining cache time in seconds, not the age of the record.",
    "workspace.record_types_2e5209": "Record types",
    "workspace.all_record_types_da2d85": "All record types",
    "workspace.select_record_types_d54710": "Select record types",
    "workspace.choose_record_types_7a9946": "Choose record types",
    "workspace.choose_one_or_0d5d48": "Choose one or more types. Press Enter in Domain name to check.",
    "workspace.resultRecords": "DNS result records",
    "workspace.lookupComplete": "DNS lookup complete",
    "workspace.dnsRecord": "DNS record",
    "workspace.records.A": "IPv4 address",
    "workspace.records.AAAA": "IPv6 address",
    "workspace.records.MX": "Mail server",
    "workspace.records.TXT": "Text and email verification",
    "workspace.records.NS": "Nameserver",
    "workspace.records.CNAME": "Domain alias",
    "workspace.noRecords": "No {type} records found",
    "workspace.status.Other record type returned": "Other record type returned",
    "workspace.status.Domain not found": "Domain not found",
    "workspace.status.Resolver failed": "Resolver failed",
    "workspace.status.Invalid response": "Invalid response",
    "workspace.status.Incomplete response": "Incomplete response",
    "workspace.forName": "For {name}",
    "workspace.copyRecord": "Copy {type} record value",
    "workspace.selectType": "Select at least one record type.",
    "workspace.chooseTypes": "Choose record types from the list.",
    "workspace.invalidDomain": "Enter a valid domain name.",
    "workspace.domainRequired": "Domain is required.",
  },
  toolId: "devtools.dns-checker",
  slug: "dns-checker",
  app: "devtools",
  category: "seo-domain-tools",
  keywords: ["dns", "mx", "txt", "spf", "nameserver", "cname", "lookup", "dig"],
  name: "DNS & Email Records Checker",
  description: "Query public DNS-over-HTTPS records.",
  layout: "side-by-side",
  resultView: { default: "preview", previewLabel: "Preview" },
  input: {
    kind: "fields",
    label: "Domain",
    fields: [
      {
        channel: "text",
        label: "Domain name",
        placeholder: "example.com",
        required: true,
        multiline: false,
        maxLength: 253,
      },
    ],
  },
  settings: {
    fields: {
      types: {
        kind: "text",
        label: "Record types",
        help: "Select one or more record types to look up.",
        default: "A,AAAA,MX,TXT,NS,CNAME",
        pane: "input",
      },
      recordView: {
        kind: "select",
        label: "Raw output format",
        help: "Choose what Raw, Copy, and Download contain. Preview always shows readable records.",
        default: "records",
        choices: [
          { label: "Records (tab-separated)", value: "records" },
          { label: "Resolver response (JSON)", value: "raw" },
        ],
      },
      recursive: {
        kind: "toggle",
        label: "Use recursive lookup",
        help: "On by default. Turning it off asks the resolver to answer only from its own cache.",
        default: true,
      },
      includeTtl: {
        kind: "toggle",
        label: "Include TTL",
        help: "Shows each record's remaining cache lifetime in seconds.",
        default: true,
      },
      checkDnssec: {
        kind: "toggle",
        label: "Check DNSSEC",
        help: "Asks the resolver to validate signatures rather than returning unverified data.",
        default: false,
      },
    },
  },
  trigger: { mode: "manual", actionLabel: "Check DNS" },
  capabilities: { copy: true, download: true, network: true },
  workbenchMark: { text: "DNS" },
  labels: {
    result: "DNS records",
    empty: "Enter a public domain to look up its DNS records.",
    ready: "DNS lookup results are ready.",
    running: "Looking up public DNS records…",
  },
  content: {
    howToUse: [
      "Enter a domain. A full URL works too — the hostname is extracted, lowercased, and a leading www. is dropped before the query.",
      "Choose the record types you care about: A and AAAA for where the site points, MX and TXT for mail delivery and SPF/DKIM/DMARC, NS for delegation, CNAME for aliases.",
      "Click Check DNS or press Enter in the domain field. Selected types are queried in parallel, and each answer returns its type, TTL, and value.",
      "Read the Preview for labeled records and lookup status. Use Raw for exact output, and choose Resolver response (JSON) in settings to inspect the resolver's full response.",
    ],
    limitations: [
      "Queries go to a public DNS-over-HTTPS resolver, so you see what that resolver sees. Split-horizon DNS, internal zones, and freshly changed records may differ from your own view.",
      "Only A, AAAA, MX, TXT, NS, and CNAME are permitted. Any other type is rejected rather than forwarded — the domain you type drives an outbound request, so the query surface is deliberately fixed.",
      "TTL is the resolver's remaining cache time, not the value published in your zone file. A low TTL here often just means the record was queried recently.",
      "Each lookup times out after ten seconds. A slow or unreachable resolver reports a failure rather than hanging.",
      "The DNSSEC option asks the resolver to validate; it does not perform independent chain-of-trust verification in your browser.",
    ],
    faq: [
      {
        q: "Why do the results differ from `dig` on my machine?",
        a: "Your local resolver, your ISP, and the public resolver used here can all hold different cached copies. Right after a change, a difference between them is normal and resolves as TTLs expire.",
      },
      {
        q: "How do I check my SPF or DMARC record?",
        a: "Query TXT. SPF appears as a value starting with v=spf1 on the domain itself; DMARC lives on the _dmarc subdomain, so query that name directly.",
      },
      {
        q: "My MX lookup is empty — is mail broken?",
        a: "Not necessarily. Check the parent domain: mail for a subdomain is usually delivered via the parent's MX records.",
      },
      {
        q: "Does the domain I type get logged?",
        a: "The lookup is a request to a public DNS resolver, which sees the queried name like any DNS query does. Nothing is stored by this tool.",
      },
    ],
    examples: [{ label: "Public domain", text: "example.com" }],
  },
} as const satisfies ToolSpec;
