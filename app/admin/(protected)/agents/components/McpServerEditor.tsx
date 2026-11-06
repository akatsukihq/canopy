"use client";

import {
  AlertBanner,
  BackButton,
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  SectionCard,
  SectionHeading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  toast,
  Toaster,
} from "@/components/ui/index.tsx";
import { mcpServerInputSchema, MCP_TRANSPORTS, type McpServer, type McpToolInfo } from "@/lib/agents/types.ts";
import { appHref } from "@/lib/routing/subdomains.ts";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteMcpServer, refreshMcpTools, saveMcpServer } from "../actions";
import { DeleteButton } from "./DeleteButton";
import { EditorHeader } from "./EditorHeader";
import { SaveActions } from "./SaveActions";

/** `stored` rows already have a secret on the server; a blank value keeps it. */
type HeaderRow = { name: string; value: string; stored: boolean };
type McpForm = {
  name: string;
  url: string;
  transport: (typeof MCP_TRANSPORTS)[number];
  enabled: boolean;
  headers: HeaderRow[];
};

function initialForm(server: McpServer | null): McpForm {
  return {
    name: server?.name ?? "",
    url: server?.url ?? "",
    transport: server?.transport ?? "http",
    enabled: server?.enabled ?? true,
    headers: (server?.headerNames ?? []).map((name) => ({ name, value: "", stored: true })),
  };
}

export function McpServerEditor({ server, canEdit }: { server: McpServer | null; canEdit: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => initialForm(server));
  const [form, setForm] = useState(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tools, setTools] = useState<McpToolInfo[] | null>(
    server && server.lastCheckedAt && !server.lastError ? server.tools : null,
  );
  const [testError, setTestError] = useState<string | null>(server?.lastError ?? null);
  const [checkedAt, setCheckedAt] = useState(server?.lastCheckedAt ?? null);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const disabled = !canEdit || saving;
  const set = (patch: Partial<McpForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setErrors({});
  };
  const setHeader = (index: number, patch: Partial<HeaderRow>) =>
    set({ headers: form.headers.map((row, i) => (i === index ? { ...row, ...patch } : row)) });

  async function save() {
    const headers: Record<string, string | null> = {};
    for (const row of form.headers) {
      if (row.name.trim()) headers[row.name.trim()] = row.stored && !row.value ? null : row.value;
    }
    const parsed = mcpServerInputSchema.safeParse({
      name: form.name,
      url: form.url,
      transport: form.transport,
      enabled: form.enabled,
      headers,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]);
        next[field] ??= field === "url" ? "Enter a full https:// address." : issue.message;
      }
      setErrors(next);
      toast.error("Some fields need attention. See the messages beside each field.");
      return;
    }
    setSaving(true);
    try {
      const result = await saveMcpServer(server?.id ?? null, parsed.data);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success("MCP server saved.");
      if (!server) {
        router.replace(appHref(`/admin/agents/mcp/${(result.data as McpServer).id}`));
        return;
      }
      // Saved values are now stored secrets: blank them but keep the rows.
      const next = {
        ...form,
        headers: form.headers
          .filter((r) => r.name.trim())
          .map((r) => ({ name: r.name.trim(), value: "", stored: true })),
      };
      setForm(next);
      setSaved(next);
      router.refresh();
    } catch {
      toast.error("Unable to save the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    if (!server) return;
    setTesting(true);
    try {
      const result = await refreshMcpTools(server.id);
      setCheckedAt(new Date().toISOString());
      if (result.ok) {
        setTools(result.data as McpToolInfo[]);
        setTestError(null);
        toast.success("Connected. Tools refreshed.");
      } else {
        setTools(null);
        setTestError(result.error);
      }
      router.refresh();
    } catch {
      setTestError("The check could not run. Try again in a moment.");
    } finally {
      setTesting(false);
    }
  }

  async function remove(): Promise<string | null> {
    if (!server) return null;
    const result = await deleteMcpServer(server.id);
    if (!result.ok) return result.error;
    router.replace(appHref("/admin/agents/mcp"));
    return null;
  }

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
              {server ? (
                <DeleteButton
                  description="This permanently deletes the server and its saved headers. It cannot be deleted while an agent uses its tools."
                  label="Delete server"
                  name={server.name}
                  onConfirm={remove}
                />
              ) : null}
            </SaveActions>
          ) : null
        }
        backHref={appHref("/admin/agents/mcp")}
        backLabel="Back to MCP servers"
        description={canEdit ? undefined : "You can view this server but not change it."}
        title={server ? server.name : "New MCP server"}
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        <div className="grid gap-5">
          <SectionCard>
            <Field error={errors.name} htmlFor="mcp-name" label="Name" required>
              <Input
                disabled={disabled}
                maxLength={80}
                onChange={(e) => set({ name: e.target.value })}
                value={form.name}
              />
            </Field>
            <Field
              description="Must be https and reachable from the public internet. Private addresses are blocked."
              error={errors.url}
              htmlFor="mcp-url"
              label="URL"
              required
            >
              <Input
                disabled={disabled}
                onChange={(e) => set({ url: e.target.value })}
                placeholder="https://mcp.example.com/mcp"
                value={form.url}
              />
            </Field>
            <Field
              description="Streamable HTTP is the current standard. Use SSE only for older servers."
              error={errors.transport}
              htmlFor="mcp-transport"
              label="Transport"
            >
              <Select
                disabled={disabled}
                onValueChange={(transport) => set({ transport: transport as McpForm["transport"] })}
                value={form.transport}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MCP_TRANSPORTS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value === "http" ? "Streamable HTTP" : "SSE"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <label className="flex items-center gap-3 text-sm font-semibold">
              <Switch checked={form.enabled} disabled={disabled} onCheckedChange={(enabled) => set({ enabled })} />
              Enabled
            </label>
          </SectionCard>
          <SectionCard>
            <SectionHeading
              action={
                <Button
                  disabled={disabled}
                  onClick={() => set({ headers: [...form.headers, { name: "", value: "", stored: false }] })}
                  type="button"
                  variant="outline"
                >
                  <Plus aria-hidden="true" /> Add header
                </Button>
              }
              className="mb-0"
              description="Sent with every request, for example Authorization. Values are encrypted and never shown again."
              title="Headers"
            />
            {errors.headers ? (
              <p className="text-xs text-destructive" role="alert">
                {errors.headers}
              </p>
            ) : null}
            {form.headers.map((row, index) => (
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] items-end gap-2" key={index}>
                <div className="grid gap-1.5">
                  <FieldLabel htmlFor={`mcp-h-name-${index}`}>Name</FieldLabel>
                  <Input
                    autoComplete="off"
                    disabled={disabled || row.stored}
                    id={`mcp-h-name-${index}`}
                    onChange={(e) => setHeader(index, { name: e.target.value })}
                    value={row.name}
                  />
                </div>
                <div className="grid gap-1.5">
                  <FieldLabel htmlFor={`mcp-h-value-${index}`}>Value</FieldLabel>
                  <Input
                    autoComplete="off"
                    disabled={disabled}
                    id={`mcp-h-value-${index}`}
                    onChange={(e) => setHeader(index, { value: e.target.value })}
                    placeholder={row.stored ? "Saved — leave blank to keep" : ""}
                    type="password"
                    value={row.value}
                  />
                </div>
                <Button
                  aria-label={`Remove header ${row.name || index + 1}`}
                  disabled={disabled}
                  onClick={() => set({ headers: form.headers.filter((_, i) => i !== index) })}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ))}
            {form.headers.some((row) => row.stored) ? (
              <FieldDescription>Saved headers keep their secret unless you type a new value.</FieldDescription>
            ) : null}
          </SectionCard>
          {server ? (
            <SectionCard>
              <SectionHeading
                action={
                  <Button
                    disabled={!canEdit || testing || dirty}
                    loading={testing}
                    onClick={test}
                    type="button"
                    variant="outline"
                  >
                    {testing ? "Testing…" : "Test & refresh tools"}
                  </Button>
                }
                className="mb-0"
                description={
                  dirty
                    ? "Save your changes first; the test uses the saved settings."
                    : checkedAt
                      ? `Last checked ${new Date(checkedAt).toLocaleString()}.`
                      : "Not checked yet."
                }
                title="Tools"
              />
              {testError ? (
                <AlertBanner variant="error">
                  {testError} Check the URL, the transport and any authorization header, then test again.
                </AlertBanner>
              ) : null}
              {tools ? (
                tools.length ? (
                  <ul className="grid gap-2">
                    {tools.map((tool) => (
                      <li key={tool.name}>
                        <span className="text-sm font-semibold">{tool.name}</span>
                        <p className="text-sm text-muted-foreground">{tool.description}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Connected, but the server lists no tools.</p>
                )
              ) : null}
            </SectionCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}
