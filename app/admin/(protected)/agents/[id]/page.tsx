import { getAgent, listAgents, listMcpServers, listSkills } from "@/lib/agents/store";
import { listConnections, listTools } from "@/lib/agents/toolStore";
import { notFound } from "next/navigation";
import { AgentEditor } from "../components/AgentEditor";
import { requireAgentsView } from "../lib/access";
import { loadAgentModels } from "../lib/models";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { canEdit } = await requireAgentsView();
  const { id } = await params;
  const isNew = id === "new";
  const [agent, agents, skills, mcpServers, tools, connections, modelChoices] = await Promise.all([
    isNew ? null : getAgent(id),
    listAgents(),
    listSkills(),
    listMcpServers(),
    listTools(),
    listConnections(),
    canEdit ? loadAgentModels() : { models: [], defaultModel: "" },
  ]);
  if (!isNew && !agent) notFound();
  const others = agents
    .filter((entry) => entry.id !== id)
    .map(({ id: agentId, name, description }) => ({ id: agentId, name, description }));
  return (
    <AgentEditor
      agent={agent}
      canEdit={canEdit}
      connections={connections}
      key={agent?.id ?? "new"}
      mcpServers={mcpServers}
      modelChoices={modelChoices}
      others={others}
      skills={skills}
      tools={tools}
    />
  );
}
