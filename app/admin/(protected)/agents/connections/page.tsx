import { AdminPageHeader } from "@/app/admin/(protected)/components/AdminPageHeader";
import { Button, EmptyState, StatusBadge } from "@/components/ui/index.tsx";
import { listConnections, listTools } from "@/lib/agents/toolStore";
import { appHref } from "@/lib/routing/subdomains.ts";
import Link from "next/link";
import { requireAgentsView } from "../lib/access";

export default async function ConnectionsPage() {
  const { canEdit } = await requireAgentsView();
  const [tools, connections] = await Promise.all([listTools(), listConnections()]);
  const endpointCount = (id: string) => tools.filter((tool) => tool.connectionId === id).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <AdminPageHeader
        actions={
          canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href={appHref("/admin/agents/connections/import")}>Import OpenAPI</Link>
              </Button>
              <Button asChild>
                <Link href={appHref("/admin/agents/connections/new")}>New connection</Link>
              </Button>
            </div>
          ) : null
        }
        className="mb-0 shrink-0"
        description="A connection groups many endpoints of one API under a shared base URL, keys and headers."
        title="Connections"
      />
      {connections.length === 0 ? (
        <EmptyState
          description="Create a connection for an API with many endpoints, or import an OpenAPI document to create them at once."
          title="No connections yet"
        />
      ) : (
        <section aria-label="Connections" className="grid content-start gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {connections.map((connection) => (
            <Link
              className="grid gap-1 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary"
              href={appHref(`/admin/agents/connections/${connection.id}`)}
              key={connection.id}
            >
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-primary">{connection.name}</span>
                <StatusBadge variant="neutral">{endpointCount(connection.id)} endpoints</StatusBadge>
                {connection.enabled ? null : <StatusBadge variant="neutral">Disabled</StatusBadge>}
              </span>
              <span className="truncate font-mono text-xs text-muted-foreground">{connection.baseUrl}</span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
