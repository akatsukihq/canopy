"use client";

import {
  AlertBanner,
  Button,
  Field,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SegmentedControl,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/index.tsx";
import type { ToolConnection } from "@/lib/agents/toolConnections.ts";
import { CODE_TOOL_LANGUAGES, HTTP_METHODS, TOOL_KINDS } from "@/lib/agents/toolTypes.ts";
import { appHref } from "@/lib/routing/subdomains.ts";
import { Link2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { schemaTextError } from "./agentForm";
import { errorAt, JsonEditor, type ToolSectionProps } from "./ToolDefinitionSections";
import { starterSource, type ToolForm } from "./toolForm";
import { TemplateInput, TemplateText } from "./TemplateText";

type Pair = ToolForm["headers"][number];
/** What the endpoint editor shows of its connection. */
export type ConnectionSummary = Pick<ToolConnection, "id" | "name" | "baseUrl" | "inputs" | "savedSecretValues">;

export function LanguageSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: ToolForm["language"];
  onChange: (value: ToolForm["language"]) => void;
  disabled: boolean;
}) {
  return (
    <Select disabled={disabled} onValueChange={(next) => onChange(next as ToolForm["language"])} value={value}>
      <SelectTrigger className="w-full" id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CODE_TOOL_LANGUAGES.map((language) => (
          <SelectItem key={language} value={language}>
            {language === "python" ? "Python" : "JavaScript (Node.js)"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FieldErrorText({ error }: { error?: string }) {
  return error ? (
    <p className="mt-2 text-xs text-destructive" role="alert">
      {error}
    </p>
  ) : null;
}

/** HTTP/Code switch, placed in the same row as the request or source it controls. */
function KindSwitch({
  form,
  set,
  disabled,
  isNew,
}: Pick<ToolSectionProps, "form" | "set" | "disabled"> & { isNew: boolean }) {
  return (
    <SegmentedControl
      aria-label="Tool kind"
      items={TOOL_KINDS.map((kind) => ({ disabled, label: kind === "http" ? "HTTP" : "Code", value: kind }))}
      onValueChange={(value) => {
        const kind = value as ToolForm["kind"];
        set(isNew ? { kind, requiresApproval: kind === "http" && form.method !== "GET" } : { kind });
      }}
      value={form.kind}
    />
  );
}

const count = (pairs: Pair[]) => (pairs.length ? ` (${pairs.length})` : "");

export function PairRows({
  noun,
  pairs,
  onChange,
  disabled,
  namePlaceholder,
  valuePlaceholder,
  error,
}: {
  noun: string;
  pairs: Pair[];
  onChange: (pairs: Pair[]) => void;
  disabled: boolean;
  namePlaceholder: string;
  valuePlaceholder: string;
  error?: string;
}) {
  const update = (index: number, patch: Partial<Pair>) =>
    onChange(pairs.map((pair, i) => (i === index ? { ...pair, ...patch } : pair)));
  return (
    <div className="grid gap-1.5">
      {pairs.length ? (
        <div
          aria-hidden="true"
          className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_2rem] gap-2 px-0.5 text-xs font-semibold text-muted-foreground"
        >
          <span>Name</span>
          <span>Value</span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No {noun}s yet.</p>
      )}
      {pairs.map((pair, index) => (
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_2rem] items-center gap-2" key={index}>
          <Input
            aria-label={`${noun} ${index + 1} name`}
            autoComplete="off"
            className="font-mono"
            disabled={disabled}
            onChange={(e) => update(index, { name: e.target.value })}
            placeholder={namePlaceholder}
            spellCheck={false}
            value={pair.name}
          />
          <TemplateInput
            aria-label={`${noun} ${index + 1} value`}
            autoComplete="off"
            className="font-mono"
            disabled={disabled}
            onChange={(e) => update(index, { value: e.target.value })}
            placeholder={valuePlaceholder}
            spellCheck={false}
            value={pair.value}
          />
          <Button
            aria-label={`Remove ${noun} ${pair.name || index + 1}`}
            disabled={disabled}
            onClick={() => onChange(pairs.filter((_, i) => i !== index))}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ))}
      <FieldErrorText error={error} />
      <div>
        <Button
          className="-ml-2"
          disabled={disabled}
          onClick={() => onChange([...pairs, { name: "", value: "" }])}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Plus aria-hidden="true" /> Add {noun}
        </Button>
      </div>
    </div>
  );
}

const BAR_CONTROL = "h-9 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent";

/** Chip linking an endpoint to its connection; sits where the kind switch is for standalone tools. */
function ConnectionChip({ connection }: { connection: ConnectionSummary }) {
  return (
    <Link
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-medium hover:bg-muted"
      href={appHref(`/admin/agents/connections/${connection.id}`)}
    >
      <Link2 aria-hidden="true" className="size-3.5" />
      {connection.name} connection
    </Link>
  );
}

function HttpFields({
  form,
  set,
  errors,
  disabled,
  isNew,
  connection,
}: ToolSectionProps & { isNew: boolean; connection: ConnectionSummary | null }) {
  const bodyError = errorAt(errors, "http.body") ?? (form.bodyText.trim() ? schemaTextError(form.bodyText) : null);
  const urlError = errorAt(errors, "http.url");
  const timeoutError = errors["http.timeoutSeconds"];
  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor="tool-url">
            {connection ? "Path" : "Endpoint"} <span className="text-destructive">*</span>
          </FieldLabel>
          {connection ? (
            <ConnectionChip connection={connection} />
          ) : (
            <KindSwitch disabled={disabled} form={form} isNew={isNew} set={set} />
          )}
        </div>
        <div
          className="flex min-w-0 items-center rounded-lg border border-input bg-background focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 aria-invalid:border-destructive"
          aria-invalid={Boolean(urlError)}
        >
          <div className="w-28 shrink-0 border-r border-border">
            <Select
              disabled={disabled}
              onValueChange={(value) => {
                const method = value as ToolForm["method"];
                set(isNew ? { method, requiresApproval: method !== "GET" } : { method });
              }}
              value={form.method}
            >
              <SelectTrigger aria-label="Method" className={`${BAR_CONTROL} w-full`} id="tool-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HTTP_METHODS.map((method) => (
                  <SelectItem key={method} value={method}>
                    {method}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {connection ? (
            <span
              aria-hidden="true"
              className="max-w-[30%] shrink-0 truncate pl-3 font-mono text-sm text-muted-foreground"
            >
              <TemplateText value={connection.baseUrl.replace(/\/+$/, "")} />
            </span>
          ) : null}
          <TemplateInput
            aria-describedby="tool-url-help"
            aria-invalid={Boolean(urlError)}
            className={`${BAR_CONTROL} font-mono`}
            wrapperClassName="flex-1"
            disabled={disabled}
            id="tool-url"
            maxLength={2000}
            onChange={(e) => set({ url: e.target.value })}
            placeholder={connection ? "/users/{{args.id}}" : "https://api.example.com/search"}
            spellCheck={false}
            value={form.url}
          />
          <label className="flex shrink-0 items-center gap-1 border-l border-border pr-3 pl-3 text-xs text-muted-foreground">
            Timeout
            <Input
              aria-invalid={Boolean(timeoutError)}
              className={`${BAR_CONTROL} w-10 px-1 text-right text-sm text-foreground`}
              disabled={disabled}
              id="tool-timeout"
              inputMode="numeric"
              onChange={(e) => set({ timeoutSeconds: e.target.value })}
              value={form.timeoutSeconds}
            />
            s
          </label>
        </div>
        {urlError || timeoutError ? (
          <p className="text-xs text-destructive" id="tool-url-help" role="alert">
            {[urlError, timeoutError && `Timeout: ${timeoutError}`].filter(Boolean).join(" ")}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground" id="tool-url-help">
            {connection ? (
              <>
                Joined to <span className="font-mono">{connection.baseUrl}</span>. Headers and inputs come from the
                connection; headers here override them.
              </>
            ) : (
              <>
                Fixed https host or a URL input, e.g.{" "}
                <code className="font-mono">{"{{inputs.baseUrl}}"}/v1/search</code>.
              </>
            )}{" "}
            Path placeholders are URL-encoded.
          </p>
        )}
      </div>

      <Tabs defaultValue="query">
        <TabsList aria-label="Request parts" className="w-full justify-start gap-4" variant="line">
          <TabsTrigger className="flex-none px-1" value="query">
            Query{count(form.query)}
          </TabsTrigger>
          <TabsTrigger className="flex-none px-1" value="headers">
            Headers{count(form.headers)}
          </TabsTrigger>
          <TabsTrigger className="flex-none px-1" value="body">
            Body
            {bodyError ? (
              <span aria-label="has an error" className="ml-1 size-1.5 rounded-full bg-destructive" role="img" />
            ) : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent className="pt-3" value="query">
          <PairRows
            disabled={disabled}
            error={errorAt(errors, "http.query")}
            namePlaceholder="q"
            noun="parameter"
            onChange={(query) => set({ query })}
            pairs={form.query}
            valuePlaceholder="{{args.query}}"
          />
        </TabsContent>
        <TabsContent className="pt-3" value="headers">
          <PairRows
            disabled={disabled}
            error={errorAt(errors, "http.headers")}
            namePlaceholder="Authorization"
            noun="header"
            onChange={(headers) => set({ headers })}
            pairs={form.headers}
            valuePlaceholder="Bearer {{inputs.apiKey}}"
          />
        </TabsContent>
        <TabsContent className="pt-3" value="body">
          {form.method === "GET" ? (
            <p className="text-sm text-muted-foreground">GET requests have no body. Pick another method to send one.</p>
          ) : (
            <div className="grid gap-1.5">
              <JsonEditor
                className="h-48"
                disabled={disabled}
                label="Body"
                onChange={(bodyText) => set({ bodyText })}
                value={form.bodyText}
              />
              {bodyError ? (
                <FieldErrorText error={bodyError} />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Optional JSON. A value that is exactly one placeholder, such as{" "}
                  <code className="font-mono">{"{{args.count}}"}</code>, keeps its type.
                </p>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CodeFields({
  form,
  set,
  errors,
  disabled,
  codeConfigured,
  isNew,
}: ToolSectionProps & { codeConfigured: boolean; isNew: boolean }) {
  const error = errorAt(errors, "code");
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor="tool-language">
          Source <span className="text-destructive">*</span>
        </FieldLabel>
        <KindSwitch disabled={disabled} form={form} isNew={isNew} set={set} />
      </div>
      <div className="-mt-1.5 overflow-hidden rounded-lg border border-input" data-invalid={Boolean(error)}>
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-2 py-1.5">
          <div className="w-52">
            <LanguageSelect
              disabled={disabled}
              id="tool-language"
              onChange={(language) =>
                set(
                  form.source === starterSource(form.language)
                    ? { language, source: starterSource(language) }
                    : { language },
                )
              }
              value={form.language}
            />
          </div>
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            Reads {'{ "args", "inputs" }'} JSON from stdin, prints the result to stdout. No network access.
          </p>
        </div>
        <JsonEditor
          className="h-[min(30rem,calc(100dvh-22rem))] min-h-64 rounded-none border-0"
          disabled={disabled}
          label="Source"
          language={form.language}
          onChange={(source) => set({ source })}
          value={form.source}
        />
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {codeConfigured ? null : (
        <AlertBanner variant="warning">
          Code execution is not configured on this server, so this tool is unavailable and returns an error when called.
        </AlertBanner>
      )}
    </div>
  );
}

export function RequestFields(
  props: ToolSectionProps & { isNew: boolean; codeConfigured: boolean; connection: ConnectionSummary | null },
) {
  return props.form.kind === "http" || props.connection ? <HttpFields {...props} /> : <CodeFields {...props} />;
}
