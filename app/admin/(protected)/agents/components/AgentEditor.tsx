"use client";

import { toast, Toaster } from "@/components/ui/index.tsx";
import type { ToolConnection } from "@/lib/agents/toolConnections.ts";
import type { CustomTool } from "@/lib/agents/toolTypes.ts";
import type { Agent, McpServer, Skill } from "@/lib/agents/types.ts";
import { appHref } from "@/lib/routing/subdomains.ts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteAgent, saveAgent } from "../actions";
import { agentToForm, emptyAgentForm, parseAgentForm, type AgentForm } from "./agentForm";
import { OutputSection } from "./AgentOutputSection";
import { AvailabilitySection, IdentitySection, ModelSection, PersonaSection } from "./AgentBasicSections";
import { SkillsSection, ToolsSection } from "./AgentCapabilitySections";
import { CustomToolsSection, customToolErrors } from "./AgentCustomToolsSection";
import { SubagentsSection } from "./AgentSubagentsSection";
import { DeleteButton } from "./DeleteButton";
import { EditorHeader } from "./EditorHeader";
import { SaveActions } from "./SaveActions";

export function AgentEditor({
  agent,
  others,
  skills,
  mcpServers,
  tools,
  connections,
  modelChoices,
  canEdit,
}: {
  agent: Agent | null;
  others: readonly { id: string; name: string; description: string }[];
  skills: readonly Skill[];
  mcpServers: readonly McpServer[];
  tools: readonly CustomTool[];
  connections: readonly ToolConnection[];
  modelChoices: { models: readonly string[]; defaultModel: string };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => (agent ? agentToForm(agent) : emptyAgentForm()));
  const [form, setForm] = useState(saved);
  const [version, setVersion] = useState(agent?.version);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = (patch: Partial<AgentForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setErrors({});
  };

  async function save() {
    const parsed = parseAgentForm(form);
    const inputErrors = customToolErrors(form, tools, connections);
    if (!parsed.ok || Object.keys(inputErrors).length) {
      setErrors({ ...(parsed.ok ? {} : parsed.errors), ...inputErrors });
      toast.error("Some fields need attention. See the messages beside each field.");
      return;
    }
    setSaving(true);
    try {
      const result = await saveAgent(agent?.id ?? null, parsed.input, version);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      const next = result.data as Agent;
      toast.success("Agent saved.");
      if (!agent) {
        router.replace(appHref(`/admin/agents/${next.id}`));
        return;
      }
      setSaved(form);
      setVersion(next.version);
      router.refresh();
    } catch {
      toast.error("Unable to save the agent. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(): Promise<string | null> {
    if (!agent) return null;
    const result = await deleteAgent(agent.id);
    if (!result.ok) return result.error;
    router.replace(appHref("/admin/agents"));
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
              {agent ? (
                <DeleteButton
                  description="This permanently deletes the agent. Agents that use it as a subagent must be updated first."
                  label="Delete agent"
                  name={agent.name}
                  onConfirm={remove}
                />
              ) : null}
            </SaveActions>
          ) : null
        }
        backHref={appHref("/admin/agents")}
        backLabel="Back to agents"
        description={canEdit ? undefined : "You can view this agent but not change it."}
        title={agent ? agent.name : "New agent"}
      />
      {/* One scroll below xl; from xl up each column scrolls on its own. */}
      <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto overscroll-contain pb-2 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:overflow-hidden xl:pb-0">
        <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] auto-rows-max content-start gap-5 xl:overflow-y-auto xl:overscroll-contain xl:pb-2">
          <IdentitySection {...section} />
          <PersonaSection {...section} />
          <OutputSection {...section} />
        </div>
        <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] auto-rows-max content-start gap-5 xl:overflow-y-auto xl:overscroll-contain xl:pb-2">
          <AvailabilitySection {...section} />
          <ModelSection {...section} {...modelChoices} />
          <ToolsSection {...section} mcpServers={mcpServers} />
          <CustomToolsSection
            {...section}
            connections={connections}
            saved={agent?.customTools ?? []}
            savedConnections={agent?.connections ?? []}
            tools={tools}
          />
          <SkillsSection {...section} skills={skills} />
          <SubagentsSection {...section} others={others} />
        </div>
      </div>
    </div>
  );
}
