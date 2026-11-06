import { getConnection, listTools } from "@/lib/agents/toolStore";
import { notFound } from "next/navigation";
import { ConnectionEditor } from "../../components/ConnectionEditor";
import { requireAgentsView } from "../../lib/access";

export default async function ConnectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { canEdit } = await requireAgentsView();
  const { id } = await params;
  const connection = id === "new" ? null : await getConnection(id);
  if (id !== "new" && !connection) notFound();
  const endpoints = connection ? (await listTools()).filter((tool) => tool.connectionId === connection.id) : [];
  return (
    <ConnectionEditor canEdit={canEdit} connection={connection} endpoints={endpoints} key={connection?.id ?? "new"} />
  );
}
