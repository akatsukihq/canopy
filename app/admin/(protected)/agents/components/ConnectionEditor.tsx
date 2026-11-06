"use client";

import {
  Button,
  Card,
  Field,
  FieldLabel,
  Input,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
  Toaster,
  TooltipProvider,
} from "@/components/ui/index.tsx";
import { cn } from "@/components/ui/lib/utils.ts";
import {
  toolConnectionInputSchema,
  type ToolConnection,
  type ToolConnectionInput,
} from "@/lib/agents/toolConnections.ts";
import { customToolName, type CustomTool } from "@/lib/agents/toolTypes.ts";
import { appHref } from "@/lib/routing/subdomains.ts";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteConnection, saveConnection } from "../actions";
import { DeleteButton } from "./DeleteButton";
import { EditorHeader } from "./EditorHeader";
import { FormSection } from "./FormSection";
import { SaveActions } from "./SaveActions";
import { HeaderSwitch, InputsFields } from "./ToolDefinitionSections";
import {
  follows,
  inputsFromForm,
  inputsToForm,
  keyFromName,
  pairsOf,
  sharedSecretsFromForm,
  toRecord,
  type InputFieldForm,
  type Pair,
} from "./toolForm";
import { PairRows } from "./ToolRequestSection";
import { TemplateInput, TemplateText } from "./TemplateText";

type ConnectionForm = {
  key: string;
  name: string;
  description: string;
  baseUrl: string;
  enabled: boolean;
  inputs: InputFieldForm[];
  headers: Pair[];
  secretValues: Record<string, string>;
  savedSecretValues: string[];
};

type Tab = "endpoints" | "inputs" | "secrets" | "headers";

const toForm = (connection: ToolConnection | null): ConnectionForm => ({
  key: connection?.key ?? "",
  name: connection?.name ?? "",
  description: connection?.description ?? "",
  baseUrl: connection?.baseUrl ?? "",
  enabled: connection?.enabled ?? true,
  inputs: inputsToForm(connection?.inputs ?? []),
  headers: pairsOf(connection?.headers),
  secretValues: {},
  savedSecretValues: connection?.savedSecretValues ?? [],
});

function parse(
  form: ConnectionForm,
): { ok: true; input: ToolConnectionInput } | { ok: false; errors: Record<string, string> } {
  const parsed = toolConnectionInputSchema.safeParse({
    key: form.key,
    name: form.name,
    description: form.description,
    baseUrl: form.baseUrl.trim(),
    inputs: inputsFromForm(form.inputs),
    headers: toRecord(form.headers),
    enabled: form.enabled,
    secretValues: sharedSecretsFromForm(form.inputs, form.secretValues),
  });
  if (parsed.success) return { ok: true, input: parsed.data };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) errors[issue.path.join(".") || "form"] ??= issue.message;
  return { ok: false, errors };
}

const tabOf = (key: string, form: ConnectionForm): Tab | null => {
  const row = /^inputs\.(\d+)\./.exec(key);
  if (row) return form.inputs[Number(row[1])]?.type === "secret" ? "secrets" : "inputs";
  if (key === "inputs") return "inputs";
  if (key.startsWith("headers") || key.startsWith("secretValues"))
    return key.startsWith("headers") ? "headers" : "secrets";
  return null;
};

function EndpointsTable({
  connectionId,
  endpoints,
}: {
  connectionId: string | null;
  endpoints: readonly CustomTool[];
}) {
  if (!connectionId)
    return <p className="text-sm text-muted-foreground">Save the connection first, then add its endpoints.</p>;
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Each endpoint is a tool the model can call. It uses this connection&apos;s base URL, inputs, secrets and
          headers.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href={appHref(`/admin/agents/tools/new?connection=${connectionId}`)}>
            <Plus aria-hidden="true" /> Add endpoint
          </Link>
        </Button>
      </div>
      {endpoints.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Method</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {endpoints.map((tool) => (
              <TableRow key={tool.id}>
                <TableCell className="font-mono text-xs font-semibold">{tool.http?.method}</TableCell>
                <TableCell className="max-w-64 truncate font-mono text-xs">
                  <TemplateText value={tool.http?.url ?? ""} />
                </TableCell>
                <TableCell>
                  <Link
                    className="font-semibold text-primary hover:underline"
                    href={appHref(`/admin/agents/tools/${tool.id}`)}
                  >
                    {tool.name}
                  </Link>
                  <span className="block font-mono text-xs text-muted-foreground">{customToolName(tool.key)}</span>
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1.5">
                    {tool.enabled ? null : <StatusBadge variant="neutral">Disabled</StatusBadge>}
                    {tool.requiresApproval ? <StatusBadge variant="warning">Needs approval</StatusBadge> : null}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No endpoints yet. Add one, or import an OpenAPI document to create many at once.
        </p>
      )}
    </div>
  );
}

export function ConnectionEditor({
  connection,
  endpoints,
  canEdit,
}: {
  connection: ToolConnection | null;
  endpoints: readonly CustomTool[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => toForm(connection));
  const [form, setForm] = useState(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>(connection ? "endpoints" : "inputs");
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const disabled = !canEdit || saving;
  const set = (patch: Partial<ConnectionForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setErrors({});
  };
  const hasErrorIn = (list: Record<string, string>) => (name: Tab) =>
    Object.keys(list).some((key) => tabOf(key, form) === name);
  const hasError = hasErrorIn(errors);

  async function save() {
    const parsed = parse(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      const first = (["inputs", "secrets", "headers"] as const).find(hasErrorIn(parsed.errors));
      if (first) setTab(first);
      toast.error("Some fields need attention. Tabs with a red dot have errors.");
      return;
    }
    setSaving(true);
    try {
      const result = await saveConnection(connection?.id ?? null, parsed.input);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success("Connection saved.");
      if (!connection) {
        router.replace(appHref(`/admin/agents/connections/${result.data.id}`));
        return;
      }
      const next = { ...form, secretValues: {}, savedSecretValues: result.data.savedSecretValues };
      setSaved(next);
      setForm(next);
      router.refresh();
    } catch {
      toast.error("Unable to save the connection. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(): Promise<string | null> {
    if (!connection) return null;
    const result = await deleteConnection(connection.id);
    if (!result.ok) return result.error;
    router.replace(appHref("/admin/agents/connections"));
    return null;
  }

  const section = { form, set, errors, disabled };
  const count = (secret: boolean) => {
    const n = form.inputs.filter((field) => (field.type === "secret") === secret).length;
    return n ? ` (${n})` : "";
  };
  const tabs: [Tab, string][] = [
    ["endpoints", `Endpoints${endpoints.length ? ` (${endpoints.length})` : ""}`],
    ["inputs", `Inputs${count(false)}`],
    ["secrets", `Secrets${count(true)}`],
    ["headers", `Headers${form.headers.length ? ` (${form.headers.length})` : ""}`],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <Toaster position="top-right" />
      <EditorHeader
        actions={
          canEdit ? (
            <SaveActions
              dirty={dirty}
              onDiscard={() => {
                setForm(saved);
                setErrors({});
              }}
              onSave={save}
              saving={saving}
            >
              {connection ? (
                <DeleteButton
                  description="This permanently deletes the connection. Delete its endpoints first."
                  disabled={endpoints.length > 0}
                  label="Delete connection"
                  name={connection.name}
                  onConfirm={remove}
                />
              ) : null}
            </SaveActions>
          ) : null
        }
        backHref={appHref("/admin/agents/connections")}
        backLabel="Back to connections"
        description={canEdit ? undefined : "You can view this connection but not change it."}
        title={connection ? connection.name : "New connection"}
      />
      <div className="grid min-h-0 auto-rows-max content-start gap-5 overflow-y-auto overscroll-contain pb-2">
        <FormSection
          actions={
            <TooltipProvider>
              <HeaderSwitch
                checked={form.enabled}
                disabled={disabled}
                help="When off, agents skip every endpoint of this connection."
                label="Enabled"
                onChange={(enabled) => set({ enabled })}
              />
            </TooltipProvider>
          }
          description="One API shared by many endpoints: set its address, keys and headers once."
          title="Connection"
        >
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)]">
            <Field error={errors.name} htmlFor="connection-name" label="Name" required>
              <Input
                disabled={disabled}
                id="connection-name"
                maxLength={80}
                onChange={(e) => {
                  const name = e.target.value;
                  set(
                    !connection && follows(form.key, form.name, (text) => keyFromName(text, 32))
                      ? { name, key: keyFromName(name, 32) }
                      : { name },
                  );
                }}
                placeholder="CRM API"
                value={form.name}
              />
            </Field>
            <Field
              description="Prefix for endpoint keys."
              error={errors.key}
              htmlFor="connection-key"
              label="Key"
              required
            >
              <Input
                className="font-mono"
                disabled={disabled}
                id="connection-key"
                maxLength={32}
                onChange={(e) => set({ key: e.target.value })}
                placeholder="crm"
                value={form.key}
              />
            </Field>
            <Field error={errors.description} htmlFor="connection-description" label="Description">
              <Textarea
                className="min-h-9"
                disabled={disabled}
                id="connection-description"
                maxLength={1000}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="What this API is for (admins only; the model reads each endpoint's description)."
                rows={1}
                value={form.description}
              />
            </Field>
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="connection-base-url">
              Base URL <span className="text-destructive">*</span>
            </FieldLabel>
            <TemplateInput
              aria-invalid={Boolean(errors.baseUrl)}
              className="font-mono"
              disabled={disabled}
              id="connection-base-url"
              onChange={(e) => set({ baseUrl: e.target.value })}
              placeholder="https://api.example.com/v1"
              value={form.baseUrl}
            />
            <p
              className={cn("text-xs", errors.baseUrl ? "text-destructive" : "text-muted-foreground")}
              role={errors.baseUrl ? "alert" : undefined}
            >
              {errors.baseUrl ??
                "Endpoint paths are added to this. A fixed https address, or a URL input such as {{inputs.baseUrl}} when each agent uses its own server."}
            </p>
          </div>
        </FormSection>

        <Card className="min-w-0 gap-0 p-0 shadow-none">
          <Tabs onValueChange={(value) => setTab(value as Tab)} value={tab}>
            <TabsList className="w-full justify-start gap-4 px-4" variant="line">
              {tabs.map(([value, label]) => (
                <TabsTrigger className="flex-none px-1" key={value} value={value}>
                  {label}
                  {hasError(value) ? (
                    <span aria-label="has errors" className="ml-1.5 size-1.5 rounded-full bg-destructive" role="img" />
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent className="p-4" value="endpoints">
              <EndpointsTable connectionId={connection?.id ?? null} endpoints={endpoints} />
            </TabsContent>
            <TabsContent className="p-4" value="inputs">
              <InputsFields {...section} group="inputs" />
            </TabsContent>
            <TabsContent className="p-4" value="secrets">
              <InputsFields {...section} group="secrets" />
            </TabsContent>
            <TabsContent className="p-4" value="headers">
              <div className="grid gap-3">
                <p className="text-xs text-muted-foreground">
                  Sent with every endpoint, e.g.{" "}
                  <code className="font-mono">{"Authorization: Bearer {{inputs.apiKey}}"}</code>. An endpoint&apos;s own
                  header with the same name wins.
                </p>
                <PairRows
                  disabled={disabled}
                  error={errors.headers}
                  namePlaceholder="Authorization"
                  noun="header"
                  onChange={(headers) => set({ headers })}
                  pairs={form.headers}
                  valuePlaceholder="Bearer {{inputs.apiKey}}"
                />
              </div>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}
