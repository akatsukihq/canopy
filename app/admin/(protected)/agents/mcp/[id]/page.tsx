import { listMcpServers } from "@/lib/agents/store";
import { notFound } from "next/navigation";
import { McpServerEditor } from "../../components/McpServerEditor";
import { requireAgentsView } from "../../lib/access";

export default async function McpServerPage({ params }: { params: Promise<{ id: string }> }) {
  const { canEdit } = await requireAgentsView();
  const { id } = await params;
  const server = id === "new" ? null : ((await listMcpServers()).find((entry) => entry.id === id) ?? null);
  if (id !== "new" && !server) notFound();
  return <McpServerEditor canEdit={canEdit} key={server?.id ?? "new"} server={server} />;
}
