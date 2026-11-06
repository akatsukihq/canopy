"use client";

import { Checkbox, ChipMultiSelect, Field } from "@/components/ui/index.tsx";
import { BUILTIN_TOOLS, type McpServer, type Skill } from "@/lib/agents/types.ts";
import { FormSection, SectionLink, type SectionProps } from "./FormSection";

const mcpKey = (serverId: string, tool: string) => `${serverId}\u0000${tool}`;

export function ToolsSection({ form, set, disabled, mcpServers }: SectionProps & { mcpServers: readonly McpServer[] }) {
  const mcpOptions = mcpServers.flatMap((server) =>
    server.tools.map((tool) => ({
      value: mcpKey(server.id, tool.name),
      label: `${server.name} · ${tool.name}`,
      description: tool.description,
    })),
  );
  const mcpValue = form.mcpTools.map((ref) => mcpKey(ref.serverId, ref.tool));

  return (
    <FormSection
      actions={<SectionLink href="/admin/agents/mcp">MCP servers</SectionLink>}
      description="What the agent can do beyond writing text."
      title="Tools"
    >
      <Checkbox
        checked={form.webSearch}
        description="Lets the model search the web through the AI provider."
        disabled={disabled}
        label="Web search"
        onCheckedChange={(checked) => set({ webSearch: checked === true })}
      />
      <Field description="Tools built into the platform." htmlFor="agent-builtin-tools" label="Built-in tools">
        <ChipMultiSelect
          aria-label="Built-in tools"
          disabled={disabled}
          emptyText="No built-in tools."
          onChange={(builtinTools) => set({ builtinTools: builtinTools as typeof form.builtinTools })}
          options={BUILTIN_TOOLS.map((tool) => ({ value: tool, label: tool }))}
          placeholder="Add a built-in tool…"
          value={form.builtinTools}
        />
      </Field>
      <Field
        description={
          mcpServers.length === 0
            ? "No MCP servers yet. Add one under MCP servers."
            : mcpOptions.length === 0
              ? "No tools cached. Open a server and choose “Test & refresh tools”."
              : "Tools from your connected MCP servers."
        }
        htmlFor="agent-mcp-tools"
        label="MCP tools"
      >
        <ChipMultiSelect
          aria-label="MCP tools"
          disabled={disabled || mcpOptions.length === 0}
          emptyText="No MCP tools."
          onChange={(keys) =>
            set({
              mcpTools: keys.map((key) => {
                const [serverId, tool] = key.split("\u0000");
                return { serverId, tool };
              }),
            })
          }
          options={mcpOptions}
          placeholder="Add an MCP tool…"
          value={mcpValue}
        />
      </Field>
    </FormSection>
  );
}

export function SkillsSection({ form, set, disabled, skills }: SectionProps & { skills: readonly Skill[] }) {
  return (
    <FormSection
      actions={<SectionLink href="/admin/agents/skills">Skills</SectionLink>}
      description="Only each skill's description is always in the agent's context. The full text loads on demand."
      title="Skills"
    >
      <ChipMultiSelect
        aria-label="Skills"
        disabled={disabled || skills.length === 0}
        emptyText={skills.length ? "No skills attached." : "No skills yet. Add one under Skills."}
        onChange={(skillIds) => set({ skillIds })}
        options={skills.map((skill) => ({ value: skill.id, label: skill.name, description: skill.description }))}
        placeholder="Add a skill…"
        value={form.skillIds}
      />
    </FormSection>
  );
}
