"use client";
import { useTranslations as useToolTranslations } from "next-intl";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { CopyButton, ResultView } from "@/components/ResultView";
import { ScrollRegion } from "@/components/Stacks";
import { ToolWorkspace, type WorkspaceProps } from "@/components/ToolWorkspace";
import {
  Checkbox,
  FieldDescription,
  FieldError,
  FieldLabel,
  H3,
  Muted,
  Popover,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  selectTriggerVariants,
} from "@/components/ui/index.tsx";
import { normalizeDomain } from "@/lib/devtools/shared/url";
import type { ToolResult } from "@/lib/tool-framework/result";
import { DNS_RECORD_TYPES } from "./run";

const RECORD_DESCRIPTIONS = {
  A: "IPv4 address",
  AAAA: "IPv6 address",
  MX: "Mail server",
  TXT: "Text and email verification",
  NS: "Nameserver",
  CNAME: "Domain alias",
} as const;

function DnsResultPreview({ result, domain }: { result: ToolResult; domain: string }) {
  const toolText = useToolTranslations("Tool.runtime");
  const records = "tablePreview" in result ? result.tablePreview : undefined;
  const lookupStatus = result.sections?.find(
    (section) => section.titleMessage?.key === "dns.lookupStatus" || section.title === "Lookup status",
  )?.body;
  const statuses = lookupStatus?.render === "table" ? lookupStatus.rows : [];
  const showTtl = records?.columns.includes("TTL (seconds)");
  const types = [...new Set([...statuses.map(([type]) => type), ...(records?.rows.map(([type]) => type) ?? [])])];
  const rows = types.flatMap((type) => {
    const answers: {
      type: string;
      name?: string;
      value?: string;
      ttl?: string;
      status?: string;
      statusLabel?: string;
      detail?: string;
    }[] = (records?.rows ?? [])
      .filter(([recordType]) => recordType === type)
      .map(([, name, value, ttl]) => ({ type, name, value, ttl }));
    const lookupIndex = statuses.findIndex(([queriedType]) => queriedType === type);
    const lookup = statuses[lookupIndex];
    const messages = lookupStatus?.render === "table" ? lookupStatus.rowMessages?.[lookupIndex] : undefined;
    if (lookup) {
      const [, status, rawDetail] = lookup;
      const detail = messages?.[2] ? toolText(messages[2].key, messages[2].values) : rawDetail;
      const statusLabel = messages?.[1] ? toolText(messages[1].key, messages[1].values) : undefined;
      if (status !== "Records returned") {
        answers.push({ type, status, statusLabel, detail });
      } else if (!answers.length && !records?.truncated) {
        answers.push({ type, status: "Other record type returned", detail });
      }
    }
    return answers;
  });

  return (
    <ScrollRegion
      accessibleName={toolText("workspace.resultRecords")}
      className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]]:overflow-x-auto! [&_[data-slot=scroll-area-viewport]>div]:block! [&_[data-slot=table-container]]:overflow-visible"
    >
      <div className="space-y-2 p-4">
        <H3>{result.verdict?.label ?? toolText("workspace.lookupComplete")}</H3>
        {result.verdict?.detail ? <Muted>{result.verdict.detail}</Muted> : null}
      </div>
      {rows.length ? (
        <Table
          className="w-full min-w-[36rem] table-fixed"
          aria-label={toolText("workspace.dns_records_00ce58")}
          tabIndex={0}
        >
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">{toolText("workspace.type_baaddf")}</TableHead>
              <TableHead className="w-36">{toolText("workspace.explanation_16ee46")}</TableHead>
              <TableHead>{toolText("workspace.record_value_f7b42a")}</TableHead>
              {showTtl ? <TableHead className="w-24">{toolText("workspace.cache_time_72f91b")}</TableHead> : null}
              <TableHead className="w-24">
                <span className="sr-only">{toolText("workspace.copy_value_c019c0")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ type, name, value, ttl, status, statusLabel, detail }, index) => (
              <TableRow key={index}>
                <TableCell className="align-top">{type}</TableCell>
                <TableCell className="align-top whitespace-normal">
                  {Object.hasOwn(RECORD_DESCRIPTIONS, type)
                    ? toolText(`workspace.records.${type}`)
                    : toolText("workspace.dnsRecord")}
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  {status ? (
                    <>
                      <span>
                        {status === "No records"
                          ? toolText("workspace.noRecords", { type })
                          : (statusLabel ?? toolText(`workspace.status.${status}`))}
                      </span>
                      {status !== "No records" ? <Muted className="mt-1">{detail}</Muted> : null}
                    </>
                  ) : value === "" || (type === "TXT" && value === '""') ? (
                    <Muted>{toolText("workspace.empty_value_19ad22")}</Muted>
                  ) : (
                    <span className="whitespace-pre-wrap break-all">{value}</span>
                  )}
                  {name && name.toLowerCase().replace(/\.$/, "") !== domain ? (
                    <Muted className="mt-1 break-all">{toolText("workspace.forName", { name })}</Muted>
                  ) : null}
                  {type === "MX" && value !== undefined ? (
                    <Muted className="mt-1">
                      {/^0\s+\.$/.test(value.trim())
                        ? toolText("workspace.this_domain_declares_30129b")
                        : toolText("workspace.the_first_number_5715af")}
                    </Muted>
                  ) : null}
                </TableCell>
                {showTtl ? (
                  <TableCell className="align-top whitespace-normal">
                    {value === undefined ? "—" : ttl === "—" ? toolText("workspace.not_supplied_8b427d") : `${ttl} s`}
                  </TableCell>
                ) : null}
                <TableCell className="align-top">
                  {value !== undefined ? (
                    <CopyButton content={value} iconOnly label={toolText("workspace.copyRecord", { type })} />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      <div className="space-y-2 p-4">
        {records?.truncated ? <Muted>{toolText("workspace.showing_part_of_3b2915")}</Muted> : null}
        {statuses.some(([, status]) => status === "No records") ? (
          <Muted>{toolText("workspace.a_missing_record_20741a")}</Muted>
        ) : null}
        {showTtl && records?.rows.length ? <Muted>{toolText("workspace.ttl_is_the_3d47e3")}</Muted> : null}
      </div>
    </ScrollRegion>
  );
}

export default function DnsCheckerWorkspace(props: WorkspaceProps) {
  const toolText = useToolTranslations("Tool.runtime");
  const id = useId();
  const [submitted, setSubmitted] = useState(false);
  const disabled = Boolean(props.disabled || props.running || props.primaryAction?.running);
  const types = (typeof props.settings.types === "string" ? props.settings.types : DNS_RECORD_TYPES.join(","))
    .split(",")
    .map((type) => type.trim().toUpperCase())
    .filter(Boolean);
  const selected = DNS_RECORD_TYPES.filter((type) => types.includes(type));
  const typesError = !types.length
    ? toolText("workspace.selectType")
    : types.some((type) => !DNS_RECORD_TYPES.some((allowed) => allowed === type))
      ? toolText("workspace.chooseTypes")
      : null;
  let domainError: string | null = null;
  let domain = "";
  try {
    domain = normalizeDomain(props.input.text).toLowerCase().replace(/\.$/, "");
  } catch (error) {
    domainError = toolText(props.input.text.trim() ? "workspace.invalidDomain" : "workspace.domainRequired");
  }
  const validationReason = domainError ?? typesError;
  const visibleDomainError = submitted || props.input.text.trim() ? domainError : null;

  useEffect(() => {
    props.onValidationChange?.(validationReason);
    return () => props.onValidationChange?.(null);
  }, [props.onValidationChange, validationReason]);

  return (
    <ToolWorkspace
      {...props}
      renderPreview={(result) => <DnsResultPreview result={result} domain={domain} />}
      renderResult={(result) => (
        <ResultView
          language={props.settings.recordView === "raw" ? "json" : undefined}
          result={result.render === "text" ? { render: "text", text: result.text } : result}
        />
      )}
      inputFieldErrors={visibleDomainError ? { text: visibleDomainError } : undefined}
      onInputSubmit={() => {
        setSubmitted(true);
        if (disabled || validationReason || !props.primaryAction || props.primaryAction.disabled) return;
        props.primaryAction.onRun();
      }}
      renderInputSettings={() => (
        <div className="grid shrink-0 gap-1.5">
          <FieldLabel htmlFor={id}>{toolText("workspace.record_types_2e5209")}</FieldLabel>
          <Popover.Root>
            <Popover.Trigger
              aria-describedby={`${id}-selection ${id}-help`}
              aria-invalid={Boolean(typesError)}
              aria-label={toolText("workspace.record_types_2e5209")}
              className={selectTriggerVariants()}
              disabled={disabled}
              id={id}
            >
              <span data-slot="select-value" id={`${id}-selection`}>
                {selected.length === DNS_RECORD_TYPES.length
                  ? toolText("workspace.all_record_types_da2d85")
                  : selected.length
                    ? selected.join(", ")
                    : toolText("workspace.select_record_types_d54710")}
              </span>
              <ChevronDown aria-hidden="true" className="size-[15px] shrink-0" />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="start"
                aria-label={toolText("workspace.choose_record_types_7a9946")}
                className="z-50 grid w-72 max-w-[calc(100vw-32px)] gap-2 rounded-lg border border-input bg-popover p-3 text-popover-foreground shadow-md"
                sideOffset={4}
              >
                {DNS_RECORD_TYPES.map((type) => (
                  <Checkbox
                    aria-describedby={`${id}-${type}-help`}
                    aria-label={type}
                    checked={selected.includes(type)}
                    description={<span id={`${id}-${type}-help`}>{toolText(`workspace.records.${type}`)}</span>}
                    disabled={disabled}
                    key={type}
                    label={type}
                    onCheckedChange={(checked) =>
                      props.onSettingChange(
                        "types",
                        DNS_RECORD_TYPES.filter((candidate) =>
                          candidate === type ? checked === true : selected.includes(candidate),
                        ).join(","),
                      )
                    }
                  />
                ))}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          {typesError ? (
            <FieldError id={`${id}-help`}>{typesError}</FieldError>
          ) : (
            <FieldDescription id={`${id}-help`}>{toolText("workspace.choose_one_or_0d5d48")}</FieldDescription>
          )}
        </div>
      )}
    />
  );
}
