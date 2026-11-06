"use client";

import {
  AlertBanner,
  Button,
  Checkbox,
  Field,
  Input,
  StatusBadge,
  Textarea,
  toast,
  Toaster,
} from "@/components/ui/index.tsx";
import type { OpenApiPreview } from "@/lib/agents/openApiImport.ts";
import { appHref } from "@/lib/routing/subdomains.ts";
import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { importOpenApiConnection, previewOpenApiImport } from "../actions";
import { EditorHeader } from "./EditorHeader";
import { FormSection } from "./FormSection";
import { TemplateText } from "./TemplateText";

const MAX_FILE_BYTES = 5_000_000;

/** Imported keys are "<connection key>_<operation>"; renaming the connection re-prefixes them. */
const rekey = (key: string, from: string, to: string) =>
  key.startsWith(`${from}_`) ? `${to}${key.slice(from.length)}` : key;

export function OpenApiImport() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<OpenApiPreview | null>(null);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast.error("The file is too large (5 MB max).");
      return;
    }
    setSource(await file.text());
    setPreview(null);
  }

  async function runPreview() {
    setBusy("preview");
    try {
      const result = await previewOpenApiImport(source);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPreview(result.data);
      setName(result.data.connection.name);
      setKey(result.data.connection.key);
      setSelected(new Set(result.data.endpoints.filter((entry) => entry.tool).map((entry) => entry.label)));
    } catch {
      toast.error("The document could not be read. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    if (!preview) return;
    const original = preview.connection.key;
    const tools = preview.endpoints
      .filter((entry) => entry.tool && selected.has(entry.label))
      .map((entry) => ({ ...entry.tool!, key: rekey(entry.tool!.key, original, key) }));
    setBusy("import");
    try {
      const result = await importOpenApiConnection({ connection: { ...preview.connection, name, key }, tools });
      if (!result.ok) {
        // No form fields to highlight here: name the first problem instead.
        const [path, message] = Object.entries(result.fieldErrors ?? {})[0] ?? [];
        toast.error(path ? `${path}: ${message}` : result.error);
        return;
      }
      toast.success(`Imported ${tools.length} endpoints.`);
      router.replace(appHref(`/admin/agents/connections/${result.data.id}`));
    } catch {
      toast.error("The import could not be saved. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const importable = preview?.endpoints.filter((entry) => entry.tool) ?? [];
  const toggle = (label: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(label);
    else next.delete(label);
    setSelected(next);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <Toaster position="top-right" />
      <EditorHeader
        actions={
          <Button
            disabled={!preview || !selected.size || !name.trim() || !key.trim()}
            loading={busy === "import"}
            onClick={runImport}
          >
            {preview ? `Import ${selected.size} endpoints` : "Import"}
          </Button>
        }
        backHref={appHref("/admin/agents/connections")}
        backLabel="Back to connections"
        description="Creates one connection and a tool for each chosen operation. Nothing is saved until you import."
        title="Import OpenAPI"
      />
      <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto pb-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:overflow-hidden lg:pb-0">
        <FormSection description="OpenAPI 3.x, JSON or YAML. Swagger 2.0 is not supported." title="1. Document">
          <Textarea
            aria-label="OpenAPI document"
            className="h-[min(50vh,28rem)] font-mono text-xs"
            onChange={(e) => {
              setSource(e.target.value);
              setPreview(null);
            }}
            placeholder={"openapi: 3.0.3\ninfo:\n  title: My API\nservers:\n  - url: https://api.example.com\npaths: …"}
            value={source}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
              className="sr-only"
              onChange={(e) => {
                void readFile(e.target.files?.[0]);
                e.target.value = "";
              }}
              ref={fileInput}
              tabIndex={-1}
              type="file"
            />
            <Button onClick={() => fileInput.current?.click()} size="sm" type="button" variant="outline">
              <Upload aria-hidden="true" /> Upload file
            </Button>
            <Button disabled={!source.trim()} loading={busy === "preview"} onClick={runPreview} type="button">
              Preview
            </Button>
          </div>
        </FormSection>

        <div className="min-h-0 lg:overflow-y-auto lg:pb-2">
          <FormSection
            description={
              preview
                ? `${importable.length} of ${preview.endpoints.length} operations can be imported. Writes start with approval on.`
                : "Paste or upload a document, then choose Preview."
            }
            title="2. Review"
          >
            {preview ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field htmlFor="import-name" label="Connection name" required>
                    <Input id="import-name" maxLength={80} onChange={(e) => setName(e.target.value)} value={name} />
                  </Field>
                  <Field description="Prefix of every endpoint key." htmlFor="import-key" label="Key" required>
                    <Input
                      className="font-mono"
                      id="import-key"
                      maxLength={32}
                      onChange={(e) => setKey(e.target.value)}
                      value={key}
                    />
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground">
                  Base URL{" "}
                  <code className="font-mono text-foreground">
                    <TemplateText value={preview.connection.baseUrl} />
                  </code>
                  {preview.connection.inputs.length
                    ? ` · Agents enter: ${preview.connection.inputs.map((field) => field.label).join(", ")}`
                    : null}
                </p>
                {preview.warnings.map((warning) => (
                  <AlertBanner key={warning} variant="warning">
                    {warning}
                  </AlertBanner>
                ))}
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Operations · {selected.size} selected
                    </span>
                    <Checkbox
                      checked={selected.size === importable.length ? true : selected.size ? "indeterminate" : false}
                      disabled={!importable.length}
                      label="All"
                      onCheckedChange={(checked) =>
                        setSelected(new Set(checked === true ? importable.map((entry) => entry.label) : []))
                      }
                    />
                  </div>
                  {preview.endpoints.map((entry) => {
                    const [method, path] = entry.label.split(" ");
                    return (
                      <div className="grid gap-0.5 py-1" key={entry.label}>
                        <Checkbox
                          checked={selected.has(entry.label)}
                          disabled={!entry.tool}
                          label={
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="w-14 shrink-0 font-mono text-[11px] font-semibold text-muted-foreground">
                                {method}
                              </span>
                              <span className="truncate font-mono text-xs">{path}</span>
                              {entry.tool ? (
                                <span className="truncate text-xs text-muted-foreground">{entry.tool.name}</span>
                              ) : null}
                              {entry.tool?.requiresApproval ? (
                                <StatusBadge variant="warning">Needs approval</StatusBadge>
                              ) : null}
                            </span>
                          }
                          onCheckedChange={(checked) => toggle(entry.label, checked === true)}
                        />
                        {entry.error ? <p className="ml-6 text-xs text-destructive">{entry.error}</p> : null}
                        {entry.notes.map((note) => (
                          <p className="ml-6 text-xs text-muted-foreground" key={note}>
                            {note}
                          </p>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                The connection and its operations appear here.
              </p>
            )}
          </FormSection>
        </div>
      </div>
    </div>
  );
}
