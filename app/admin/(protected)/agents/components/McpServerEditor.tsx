"use client";

import {
  AlertBanner,
  BackButton,
  Button,
  Field,
  FieldDescription,
  Input,
  SectionCard,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  Toaster,
} from "@/components/ui/index.tsx";
import { cn } from "@/components/ui/lib/utils.ts";
import { SAVED_SECRET_MASK } from "@/utils/secretMask.ts";
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
      const savedServer = result.data as McpServer;
      setTools(savedServer.tools);
      setTestError(null);
      setCheckedAt(savedServer.lastCheckedAt);
      toast.success(`Connected and saved. ${savedServer.tools.length} tools found.`);
      if (!server) {
        router.replace(appHref(`/admin/agents/mcp/${savedServer.id}`));
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
        <div className="grid gap-4">
          <SectionCard>
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <Field error={errors.name} htmlFor="mcp-name" label="Name" required>
                  <Input
                    disabled={disabled}
                    maxLength={80}
                    onChange={(e) => set({ name: e.target.value })}
                    value={form.name}
                  />
                </Field>
              </div>
              <label className="flex h-9 shrink-0 items-center gap-2 pt-0 text-sm font-semibold sm:mt-6">
                <Switch checked={form.enabled} disabled={disabled} onCheckedChange={(enabled) => set({ enabled })} />
                Enabled
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
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
                description="Use SSE only for older servers."
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
            </div>
          </SectionCard>
          <SectionCard>
            <Tabs defaultValue="headers">
              <TabsList aria-label="Server details" className="w-full justify-start gap-4" variant="line">
                <TabsTrigger className="flex-none px-1" value="headers">
                  Headers{form.headers.length ? ` (${form.headers.length})` : ""}
                  {errors.headers ? (
                    <span aria-label="has an error" className="ml-1 size-1.5 rounded-full bg-destructive" role="img" />
                  ) : null}
                </TabsTrigger>
                {server ? (
                  <TabsTrigger className="flex-none px-1" value="tools">
                    Tools{tools?.length ? ` (${tools.length})` : ""}
                    {testError ? (
                      <span
                        aria-label="has an error"
                        className="ml-1 size-1.5 rounded-full bg-destructive"
                        role="img"
                      />
                    ) : null}
                  </TabsTrigger>
                ) : null}
              </TabsList>
              <TabsContent className="grid gap-3 pt-3" value="headers">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Sent with every request, for example Authorization. Values are encrypted and never shown again.
                  </p>
                  <Button
                    disabled={disabled}
                    onClick={() => set({ headers: [...form.headers, { name: "", value: "", stored: false }] })}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Plus aria-hidden="true" /> Add header
                  </Button>
                </div>
                {errors.headers ? (
                  <p className="text-xs text-destructive" role="alert">
                    {errors.headers}
                  </p>
                ) : null}
                {form.headers.length ? (
                  <div className="grid gap-1.5">
                    <div
                      aria-hidden="true"
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_2rem] gap-2 px-0.5 text-xs font-semibold text-muted-foreground"
                    >
                      <span>Name</span>
                      <span>Value</span>
                    </div>
                    {form.headers.map((row, index) => (
                      <div
                        className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_2rem] items-center gap-2"
                        key={index}
                      >
                        <Input
                          aria-label={`Header ${index + 1} name`}
                          autoComplete="off"
                          className="font-mono"
                          disabled={disabled || row.stored}
                          onChange={(e) => setHeader(index, { name: e.target.value })}
                          placeholder="Authorization"
                          spellCheck={false}
                          value={row.name}
                        />
                        <Input
                          aria-label={`Header ${index + 1} value`}
                          autoComplete="off"
                          disabled={disabled}
                          onChange={(e) => setHeader(index, { value: e.target.value.replaceAll("•", "") })}
                          placeholder="Bearer …"
                          spellCheck={false}
                          type="password"
                          value={row.value || (row.stored ? SAVED_SECRET_MASK : "")}
                        />
                        <Button
                          aria-label={`Remove header ${row.name || index + 1}`}
                          disabled={disabled}
                          onClick={() => set({ headers: form.headers.filter((_, i) => i !== index) })}
                          size="icon-sm"
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
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No headers. Add one if the server needs a key.</p>
                )}
              </TabsContent>
              {server ? (
                <TabsContent className="grid gap-3 pt-3" value="tools">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {dirty
                        ? "Save your changes first; the test uses the saved settings."
                        : checkedAt
                          ? `Last checked ${new Date(checkedAt).toLocaleString()}.`
                          : "Not checked yet."}
                    </p>
                    <Button
                      disabled={!canEdit || testing || dirty}
                      loading={testing}
                      onClick={test}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {testing ? "Testing…" : "Test & refresh tools"}
                    </Button>
                  </div>
                  {testError ? (
                    <AlertBanner variant="error">
                      {testError} Check the URL, the transport and any authorization header, then test again.
                    </AlertBanner>
                  ) : null}
                  {tools ? (
                    tools.length ? (
                      <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                        {tools.map((tool) => (
                          <ToolRow key={tool.name} tool={tool} />
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">Connected, but the server lists no tools.</p>
                    )
                  ) : null}
                </TabsContent>
              ) : null}
            </Tabs>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

/** One listed tool; long descriptions are clamped until the row is opened. */
function ToolRow({ tool }: { tool: McpToolInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-3 py-2">
      <button
        aria-expanded={open}
        className="grid w-full gap-0.5 text-left"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="font-mono text-[13px] font-semibold">{tool.name}</span>
        {tool.description ? (
          <span className={cn("text-xs text-muted-foreground", !open && "line-clamp-2")}>{tool.description}</span>
        ) : null}
      </button>
    </li>
  );
}
