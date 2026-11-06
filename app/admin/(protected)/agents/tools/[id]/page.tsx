import { codeExecutionConfigured } from "@/lib/agents/toolRuntime";
import { getConnection, getTool } from "@/lib/agents/toolStore";
import { notFound } from "next/navigation";
import { ToolEditor } from "../../components/ToolEditor";
import { requireAgentsView } from "../../lib/access";

/** `/tools/new?connection=<id>` creates an endpoint of that connection. */
export default async function ToolPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ connection?: string | string[] }>;
}) {
  const { canEdit } = await requireAgentsView();
  const { id } = await params;
  const requested = (await searchParams).connection;
  const tool = id === "new" ? null : await getTool(id);
  if (id !== "new" && !tool) notFound();
  const connectionId = tool ? tool.connectionId : typeof requested === "string" ? requested : null;
  const found = connectionId ? await getConnection(connectionId) : null;
  if (connectionId && !found) notFound();
  const connection = found && {
    id: found.id,
    name: found.name,
    baseUrl: found.baseUrl,
    inputs: found.inputs,
    savedSecretValues: found.savedSecretValues,
  };
  return (
    <ToolEditor
      canEdit={canEdit}
      codeConfigured={codeExecutionConfigured()}
      connection={connection}
      key={tool?.id ?? `new-${connectionId ?? ""}`}
      tool={tool}
    />
  );
}
