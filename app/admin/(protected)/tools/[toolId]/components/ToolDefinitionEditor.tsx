"use client";

import { CodeEditor } from "@/components/content/CodeEditor.tsx";
import {
  Button,
  Caption,
  Field,
  Input,
  Select,
  StatusBadge,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@/components/ui/index.tsx";
import { appHref } from "@/lib/routing/subdomains.ts";
import { Copy, Eye, Save, Trash2, Upload } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { categoriesForApp, TOOL_CATEGORIES, type ToolApp } from "../../../../../../lib/tool-framework/categories";
import { parseToolSpec } from "../../../../../../lib/tool-framework/specSchema";
import {
  discardToolSpecDraftAction,
  publishToolSpecDraftAction,
  saveToolSpecDraftAction,
  type ToolSpecActionState,
} from "../../actions";

const IDLE: ToolSpecActionState = { status: "idle", message: "" };
type Obj = Record<string, unknown>;
type View = "json" | "form";

const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const pretty = (value: unknown): string => JSON.stringify(value ?? {}, null, 2);

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; issue: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, issue: `spec: not valid JSON (${error instanceof Error ? error.message : "parse error"})` };
  }
}

/** Replaces one key without disturbing the order of the others. */
function withKey(source: Obj, key: string, value: unknown): Obj {
  if (value === undefined) return Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));
  return { ...source, [key]: value };
}

function IssueList({ id, issues }: { id: string; issues: readonly string[] }) {
  return (
    <div aria-live="polite" id={id}>
      {issues.length ? (
        <ul className="space-y-1 text-sm text-destructive">
          {issues.map((issue) => (
            <li className="break-words" key={issue}>
              {issue}
            </li>
          ))}
        </ul>
      ) : (
        <Caption className="text-muted-foreground">The definition is valid.</Caption>
      )}
    </div>
  );
}

function FormView({ onChange, spec, app }: { app: ToolApp; onChange: (next: Obj) => void; spec: Obj }) {
  const set = (key: string, value: unknown) => onChange(withKey(spec, key, value));
  const trigger = isObj(spec.trigger) ? spec.trigger : {};
  const labels = isObj(spec.labels) ? spec.labels : {};
  const settings = isObj(spec.settings) ? spec.settings : {};
  const fields = isObj(settings.fields) ? settings.fields : {};
  const live = trigger.mode === "live";
  const setSetting = (name: string, field: Obj, key: string, value: unknown) =>
    onChange({
      ...spec,
      settings: { ...settings, fields: { ...fields, [name]: withKey(field, key, value) } },
    });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field htmlFor="def-name" label="Name">
        <Input id="def-name" onChange={(e) => set("name", e.target.value)} value={str(spec.name)} />
      </Field>
      <Field htmlFor="def-category" label="Category">
        <Select id="def-category" onChange={(e) => set("category", e.target.value)} value={str(spec.category)}>
          <option value="">Choose a category</option>
          {categoriesForApp(app).map((key) => (
            <option key={key} value={key}>
              {TOOL_CATEGORIES[key].label}
            </option>
          ))}
        </Select>
      </Field>
      <Field className="md:col-span-2" htmlFor="def-description" label="Description">
        <Textarea
          id="def-description"
          onChange={(e) => set("description", e.target.value)}
          rows={2}
          value={str(spec.description)}
        />
      </Field>
      <Field className="md:col-span-2" description="Comma separated." htmlFor="def-keywords" label="Keywords">
        <Input
          defaultValue={Array.isArray(spec.keywords) ? spec.keywords.join(", ") : ""}
          id="def-keywords"
          key={Array.isArray(spec.keywords) ? spec.keywords.join(",") : ""}
          onBlur={(e) =>
            set(
              "keywords",
              e.target.value
                .split(",")
                .map((word) => word.trim())
                .filter(Boolean),
            )
          }
        />
      </Field>

      <Field htmlFor="def-trigger" label="Trigger">
        <Select
          id="def-trigger"
          onChange={(e) =>
            set("trigger", e.target.value === "live" ? { mode: "live" } : { mode: "manual", actionLabel: "Run" })
          }
          value={live ? "live" : "manual"}
        >
          <option value="live">Live (runs as you type)</option>
          <option value="manual">Manual (button)</option>
        </Select>
      </Field>
      {live ? (
        <Field htmlFor="def-debounce" label="Debounce (ms)">
          <Input
            id="def-debounce"
            min={0}
            onChange={(e) =>
              set("trigger", {
                ...trigger,
                debounceMs: e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
            type="number"
            value={typeof trigger.debounceMs === "number" ? trigger.debounceMs : ""}
          />
        </Field>
      ) : (
        <Field htmlFor="def-action" label="Button label">
          <Input
            id="def-action"
            onChange={(e) => set("trigger", { ...trigger, actionLabel: e.target.value })}
            value={str(trigger.actionLabel)}
          />
        </Field>
      )}

      {(["empty", "ready", "running", "result"] as const).map((key) => (
        <Field htmlFor={`def-label-${key}`} key={key} label={`Label: ${key}`}>
          <Input
            id={`def-label-${key}`}
            onChange={(e) => set("labels", { ...labels, [key]: e.target.value })}
            value={str(labels[key])}
          />
        </Field>
      ))}

      {Object.entries(fields).length ? (
        <div className="space-y-3 md:col-span-2">
          <p className="text-sm font-medium">Settings fields</p>
          {Object.entries(fields).map(([name, raw]) => {
            if (!isObj(raw)) return null;
            const kind = str(raw.kind);
            const id = `def-field-${name}`;
            return (
              <fieldset className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-3" key={name}>
                <legend className="px-1 text-xs text-muted-foreground">
                  {name} · {kind}
                </legend>
                <Field htmlFor={`${id}-label`} label="Label">
                  <Input
                    id={`${id}-label`}
                    onChange={(e) => setSetting(name, raw, "label", e.target.value)}
                    value={str(raw.label)}
                  />
                </Field>
                <Field htmlFor={`${id}-help`} label="Help">
                  <Input
                    id={`${id}-help`}
                    onChange={(e) => setSetting(name, raw, "help", e.target.value || undefined)}
                    value={str(raw.help)}
                  />
                </Field>
                <DefaultInput
                  id={`${id}-default`}
                  kind={kind}
                  onChange={(v) => setSetting(name, raw, "default", v)}
                  value={raw.default}
                />
              </fieldset>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function DefaultInput({
  id,
  kind,
  onChange,
  value,
}: {
  id: string;
  kind: string;
  onChange: (v: unknown) => void;
  value: unknown;
}) {
  if (kind === "toggle")
    return (
      <Field htmlFor={id} label="Default">
        <Select id={id} onChange={(e) => onChange(e.target.value === "true")} value={String(value === true)}>
          <option value="true">On</option>
          <option value="false">Off</option>
        </Select>
      </Field>
    );
  if (kind === "number" || kind === "slider")
    return (
      <Field htmlFor={id} label="Default">
        <Input
          id={id}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
          type="number"
          value={typeof value === "number" ? value : 0}
        />
      </Field>
    );
  if (typeof value === "string")
    return (
      <Field htmlFor={id} label="Default">
        <Input id={id} onChange={(e) => onChange(e.target.value)} value={value} />
      </Field>
    );
  return <Caption className="self-end text-muted-foreground">Default: edit in JSON view.</Caption>;
}

export function ToolDefinitionEditor({
  app,
  hasDraft: initialHasDraft,
  initialJson,
  publishedJson,
  toolId,
  updatedAt: initialUpdatedAt,
}: {
  app: ToolApp;
  hasDraft: boolean;
  initialJson: string;
  publishedJson: string;
  toolId: string;
  updatedAt: string;
}) {
  const [text, setText] = useState(initialJson);
  const [baseline, setBaseline] = useState(initialJson);
  const [hasDraft, setHasDraft] = useState(initialHasDraft);
  const [published, setPublished] = useState(publishedJson);
  const [version, setVersion] = useState(initialUpdatedAt);
  const [view, setView] = useState<View>("json");
  const [serverIssues, setServerIssues] = useState<readonly string[]>([]);
  const [saveState, save, saving] = useActionState(saveToolSpecDraftAction, IDLE);
  const [publishState, publish, publishing] = useActionState(publishToolSpecDraftAction, IDLE);
  const [discardState, discard, discarding] = useActionState(discardToolSpecDraftAction, IDLE);
  const textRef = useRef(text);
  const file = useRef<HTMLInputElement>(null);
  textRef.current = text;

  const parsed = useMemo(() => parseJson(text), [text]);
  const liveIssues = useMemo<readonly string[]>(() => {
    if (!parsed.ok) return [parsed.issue];
    const result = parseToolSpec(parsed.value);
    return result.ok ? [] : result.issues;
  }, [parsed]);
  const issues = liveIssues.length ? liveIssues : serverIssues;
  const dirty = text !== baseline;

  useEffect(() => {
    if (saveState.status === "idle") return;
    if (saveState.status === "success") {
      toast.success(saveState.message);
      setBaseline(textRef.current);
      setHasDraft(true);
      setServerIssues([]);
    } else {
      toast.error(saveState.message);
      setServerIssues(saveState.issues ?? []);
    }
    if (saveState.updatedAt) setVersion(saveState.updatedAt);
  }, [saveState]);

  useEffect(() => {
    if (publishState.status === "idle") return;
    if (publishState.status === "success") {
      toast.success(publishState.message);
      setHasDraft(false);
      setBaseline(textRef.current);
      setPublished(textRef.current);
      setServerIssues([]);
    } else {
      toast.error(publishState.message);
      setServerIssues(publishState.issues ?? []);
    }
    if (publishState.updatedAt) setVersion(publishState.updatedAt);
  }, [publishState]);

  useEffect(() => {
    if (discardState.status === "idle") return;
    if (discardState.status === "success") {
      toast.success(discardState.message);
      setHasDraft(false);
      setText(published);
      setBaseline(published);
      setServerIssues([]);
    } else {
      toast.error(discardState.message);
      setServerIssues(discardState.issues ?? []);
    }
    if (discardState.updatedAt) setVersion(discardState.updatedAt);
  }, [discardState, published]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("JSON copied.");
    } catch {
      toast.error("Could not copy. Select the JSON and copy it manually.");
    }
  }

  async function importFile(files: FileList | null) {
    const selected = files?.[0];
    if (!selected) return;
    const content = await selected.text();
    const result = parseJson(content);
    // Re-indent valid JSON so the editor and form views stay readable.
    setText(result.ok ? pretty(result.value) : content);
    toast.success("Imported. Save draft to keep it.");
    if (file.current) file.current.value = "";
  }

  const busy = saving || publishing || discarding;
  const status = dirty ? (
    <StatusBadge variant="warning">Unsaved changes</StatusBadge>
  ) : hasDraft ? (
    <StatusBadge variant="warning">Draft saved, not published</StatusBadge>
  ) : (
    <StatusBadge variant="success">Matches published</StatusBadge>
  );
  const formSpec = parsed.ok && isObj(parsed.value) ? parsed.value : null;

  return (
    <form className="flex min-h-0 flex-1 flex-col gap-3" onSubmit={(e) => e.preventDefault()}>
      <input name="toolId" type="hidden" value={toolId} />
      <input name="updatedAt" type="hidden" value={version} />
      <input name="spec" type="hidden" value={text} />
      <input
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void importFile(e.target.files)}
        ref={file}
        type="file"
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {status}
        <Tabs onValueChange={(value) => setView(value as View)} value={view}>
          <TabsList aria-label="Definition view" variant="segmented">
            <TabsTrigger value="json">JSON</TabsTrigger>
            <TabsTrigger value="form">Form</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button onClick={copy} size="sm" type="button" variant="outline">
            <Copy aria-hidden="true" /> Copy JSON
          </Button>
          <Button onClick={() => file.current?.click()} size="sm" type="button" variant="outline">
            <Upload aria-hidden="true" /> Import JSON
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={appHref(`/admin/tools/${encodeURIComponent(toolId)}/preview`)} rel="noreferrer" target="_blank">
              <Eye aria-hidden="true" /> Preview draft
            </a>
          </Button>
          <Button
            disabled={!hasDraft || busy}
            formAction={discard}
            loading={discarding}
            size="sm"
            type="submit"
            variant="outline"
          >
            <Trash2 aria-hidden="true" /> Discard draft
          </Button>
          <Button
            disabled={!hasDraft || dirty || busy}
            formAction={publish}
            loading={publishing}
            size="sm"
            type="submit"
            variant="secondary"
          >
            Publish draft
          </Button>
          <Button
            disabled={!dirty || liveIssues.length > 0 || busy}
            formAction={save}
            loading={saving}
            size="sm"
            type="submit"
          >
            <Save aria-hidden="true" /> Save draft
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto overscroll-contain lg:grid-cols-[minmax(0,1fr)_18rem] lg:overflow-hidden">
        <div className="flex min-h-[20rem] min-w-0 flex-col lg:min-h-0 lg:overflow-y-auto">
          {view === "json" || !formSpec ? (
            <>
              {view === "form" ? (
                <Caption className="mb-2 text-destructive">Fix the JSON syntax to use the form view.</Caption>
              ) : null}
              <div className="min-h-0 flex-1">
                <CodeEditor
                  aria-describedby="definition-issues"
                  aria-invalid={issues.length > 0}
                  aria-label="Tool definition JSON"
                  className="h-full"
                  language="json"
                  onChange={setText}
                  value={text}
                  wrap="soft"
                />
              </div>
            </>
          ) : (
            <FormView app={app} onChange={(next) => setText(pretty(next))} spec={formSpec} />
          )}
        </div>
        <aside className="min-w-0 lg:overflow-y-auto lg:border-l lg:border-border lg:pl-4">
          <p className="mb-2 text-sm font-medium">Validation</p>
          <IssueList id="definition-issues" issues={issues} />
        </aside>
      </div>
    </form>
  );
}
