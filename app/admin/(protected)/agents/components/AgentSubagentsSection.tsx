"use client";

import {
  Button,
  ChipMultiSelect,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/index.tsx";
import { MAX_PIPELINE_STEPS, SUBAGENT_MODES, type SubagentMode } from "@/lib/agents/types.ts";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { FormSection, SectionLink, type SectionProps } from "./FormSection";

const MODE_HELP: Record<SubagentMode, string> = {
  none: "The agent works alone.",
  delegate: "The agent can hand tasks to the chosen agents and use their answers.",
  pipeline:
    "After this agent, each listed agent runs in order, receiving the previous answer. The last answer is final.",
};

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} disabled={disabled} onClick={onClick} size="icon" type="button" variant="ghost">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function SubagentsSection({
  form,
  set,
  errors,
  disabled,
  others,
}: SectionProps & { others: readonly { id: string; name: string; description: string }[] }) {
  const { mode, agentIds } = form.subagents;
  const names = new Map(others.map((agent) => [agent.id, agent.name]));
  const setIds = (ids: string[]) => set({ subagents: { mode, agentIds: ids } });
  const move = (index: number, by: number) => {
    const next = [...agentIds];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    setIds(next);
  };
  const available = others.filter((agent) => !agentIds.includes(agent.id));

  return (
    <FormSection
      actions={<SectionLink href="/admin/agents">Agents</SectionLink>}
      description="Let this agent work with other agents."
      title="Subagents"
    >
      <Field description={MODE_HELP[mode]} error={errors.subagents} htmlFor="agent-subagent-mode" label="Mode">
        <Select
          disabled={disabled}
          onValueChange={(next) =>
            set({ subagents: { mode: next as SubagentMode, agentIds: next === "none" ? [] : agentIds } })
          }
          value={mode}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUBAGENT_MODES.map((value) => (
              <SelectItem key={value} value={value}>
                {value === "none" ? "None" : value === "delegate" ? "Delegate" : "Pipeline"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {mode === "delegate" ? (
        <Field htmlFor="agent-delegates" label="Agents it can delegate to">
          <ChipMultiSelect
            aria-label="Agents it can delegate to"
            disabled={disabled || others.length === 0}
            emptyText={others.length ? "No agents selected." : "No other agents exist yet."}
            onChange={setIds}
            options={others.map((agent) => ({ value: agent.id, label: agent.name, description: agent.description }))}
            placeholder="Add an agent…"
            value={agentIds}
          />
        </Field>
      ) : null}
      {mode === "pipeline" ? (
        <TooltipProvider>
          <div className="grid gap-2">
            <ol aria-label="Pipeline steps" className="grid gap-2">
              {agentIds.map((id, index) => (
                <li className="flex items-center gap-1 rounded-lg border border-border px-3 py-1" key={id}>
                  <span className="w-6 text-sm text-muted-foreground">{index + 1}.</span>
                  <span className="flex-1 text-sm font-semibold">{names.get(id) ?? "Missing agent"}</span>
                  <IconButton disabled={disabled || index === 0} label="Move up" onClick={() => move(index, -1)}>
                    <ArrowUp aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    disabled={disabled || index === agentIds.length - 1}
                    label="Move down"
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    disabled={disabled}
                    label="Remove step"
                    onClick={() => setIds(agentIds.filter((entry) => entry !== id))}
                  >
                    <X aria-hidden="true" />
                  </IconButton>
                </li>
              ))}
            </ol>
            {agentIds.length < MAX_PIPELINE_STEPS && available.length ? (
              <Select disabled={disabled} onValueChange={(id) => setIds([...agentIds, id])} value="">
                <SelectTrigger aria-label="Add a pipeline step" className="w-full">
                  <SelectValue placeholder="Add a step…" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </TooltipProvider>
      ) : null}
    </FormSection>
  );
}
