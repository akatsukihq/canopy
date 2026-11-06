"use client";

import { Card, Tabs, TabsContent, TabsList, TabsTrigger, toast, Toaster } from "@/components/ui/index.tsx";
import type { CustomTool } from "@/lib/agents/toolTypes.ts";
import { appHref } from "@/lib/routing/subdomains.ts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteTool, saveTool } from "../actions";
import { DeleteButton } from "./DeleteButton";
import { EditorHeader } from "./EditorHeader";
import { SaveActions } from "./SaveActions";
import { ArgumentsFields, DefinitionSection, InputsFields } from "./ToolDefinitionSections";
import { parseToolForm, toolToForm, type ToolForm } from "./toolForm";
import { OutputFields } from "./ToolOutputSection";
import { RequestFields, type ConnectionSummary } from "./ToolRequestSection";
import { TestSection } from "./ToolTestSection";

type ConfigTab = "request" | "arguments" | "inputs" | "secrets" | "output";
const TAB_ERROR_PREFIXES: Record<ConfigTab, string[]> = {
  request: ["http", "code", "kind"],
  arguments: ["argsSchema"],
  inputs: ["inputs"],
  secrets: [],
  output: ["output", "http.responsePath"],
};
/** Tab owning an error key: the longest matching prefix wins ("http.responsePath" → output); secret rows → secrets. */
const tabOf = (key: string, form: ToolForm) => {
  const row = /^inputs\.(\d+)\./.exec(key);
  if (row && form.inputs[Number(row[1])]?.type === "secret") return "secrets";
  let best: { tab: ConfigTab; length: number } | null = null;
  for (const [tab, prefixes] of Object.entries(TAB_ERROR_PREFIXES) as [ConfigTab, string[]][]) {
    for (const prefix of prefixes) {
      if ((key === prefix || key.startsWith(`${prefix}.`)) && prefix.length > (best?.length ?? -1)) {
        best = { tab, length: prefix.length };
      }
    }
  }
  return best?.tab;
};
const tabHasError = (errors: Record<string, string>, tab: ConfigTab, form: ToolForm) =>
  Object.keys(errors).some((key) => tabOf(key, form) === tab);

const counted = (items: unknown[]) => (items.length ? ` (${items.length})` : "");

export function ToolEditor({
  tool,
  canEdit,
  codeConfigured,
  connection,
}: {
  tool: CustomTool | null;
  canEdit: boolean;
  codeConfigured: boolean;
  /** Set when the tool is (or will be) an endpoint of this connection. */
  connection: ConnectionSummary | null;
}) {
  const router = useRouter();
  const backHref = appHref(connection ? `/admin/agents/connections/${connection.id}` : "/admin/agents/tools");
  const [saved, setSaved] = useState(() => toolToForm(tool, connection?.id ?? null));
  const [form, setForm] = useState(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<ConfigTab>("request");
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = (patch: Partial<ToolForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setErrors({});
  };

  async function save() {
    const parsed = parseToolForm(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      const first = (Object.keys(TAB_ERROR_PREFIXES) as ConfigTab[]).find((name) =>
        tabHasError(parsed.errors, name, form),
      );
      if (first) setTab(first);
      toast.error("Some fields need attention. Tabs with a red dot have errors.");
      return;
    }
    setSaving(true);
    try {
      const result = await saveTool(tool?.id ?? null, parsed.input);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success("Custom tool saved.");
      if (!tool) {
        router.replace(appHref(`/admin/agents/tools/${(result.data as CustomTool).id}`));
        return;
      }
      // Typed shared values are now stored; the browser only keeps which ones exist.
      const next = { ...form, secretValues: {}, savedSecretValues: (result.data as CustomTool).savedSecretValues };
      setSaved(next);
      setForm(next);
      router.refresh();
    } catch {
      toast.error("Unable to save the tool. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(): Promise<string | null> {
    if (!tool) return null;
    const result = await deleteTool(tool.id);
    if (!result.ok) return result.error;
    router.replace(backHref);
    return null;
  }

  const section = { form, set, errors, disabled: !canEdit || saving };
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
              {tool ? (
                <DeleteButton
                  description="This permanently deletes the tool. It cannot be deleted while an agent uses it."
                  label="Delete tool"
                  name={tool.name}
                  onConfirm={remove}
                />
              ) : null}
            </SaveActions>
          ) : null
        }
        backHref={backHref}
        backLabel={connection ? `Back to ${connection.name}` : "Back to custom tools"}
        description={canEdit ? undefined : "You can view this tool but not change it."}
        title={tool ? tool.name : connection ? `New ${connection.name} endpoint` : "New custom tool"}
      />
      <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto overscroll-contain pb-2 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:overflow-hidden lg:pb-0">
        <div className="grid min-h-0 auto-rows-max content-start gap-5 lg:overflow-y-auto lg:overscroll-contain lg:pb-2">
          <DefinitionSection {...section} autoKey={!tool} />
          <Card className="min-w-0 gap-0 p-0 shadow-none">
            <Tabs onValueChange={(value) => setTab(value as ConfigTab)} value={tab}>
              <TabsList className="w-full justify-start gap-4 px-4" variant="line">
                {(
                  [
                    ["request", form.kind === "http" ? "Request" : "Code"],
                    ["arguments", "Arguments"],
                    ...(connection
                      ? []
                      : ([
                          ["inputs", `Inputs${counted(form.inputs.filter((field) => field.type !== "secret"))}`],
                          ["secrets", `Secrets${counted(form.inputs.filter((field) => field.type === "secret"))}`],
                        ] as const)),
                    ["output", "Output"],
                  ] as const
                ).map(([value, label]) => (
                  <TabsTrigger className="flex-none px-1" key={value} value={value}>
                    {label}
                    {tabHasError(errors, value, form) ? (
                      <span
                        className="ml-1.5 size-1.5 rounded-full bg-destructive"
                        role="img"
                        aria-label="has errors"
                      />
                    ) : null}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent className="p-4" value="request">
                <RequestFields {...section} codeConfigured={codeConfigured} connection={connection} isNew={!tool} />
              </TabsContent>
              <TabsContent className="p-4" value="arguments">
                <ArgumentsFields {...section} />
              </TabsContent>
              <TabsContent className="p-4" value="inputs">
                <InputsFields {...section} group="inputs" />
              </TabsContent>
              <TabsContent className="p-4" value="secrets">
                <InputsFields {...section} group="secrets" />
              </TabsContent>
              <TabsContent className="p-4" value="output">
                <OutputFields {...section} codeConfigured={codeConfigured} />
              </TabsContent>
            </Tabs>
          </Card>
        </div>
        <aside aria-label="Test the tool" className="min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pb-2">
          <TestSection
            canEdit={canEdit}
            fields={connection?.inputs}
            form={form}
            onInvalid={setErrors}
            shared={
              connection
                ? connection.savedSecretValues
                : [
                    ...form.savedSecretValues.filter((id) => form.secretValues[id] !== ""),
                    ...Object.keys(form.secretValues).filter((id) => form.secretValues[id]),
                  ]
            }
            toolId={tool?.id ?? null}
          />
        </aside>
      </div>
    </div>
  );
}
