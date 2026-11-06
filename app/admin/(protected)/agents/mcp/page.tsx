import { AdminListing } from "@/app/admin/(protected)/components/AdminListing";
import { adminPageHref, paginateAdminItems } from "@/app/admin/(protected)/lib/pagination";
import { AdminPageHeader } from "@/app/admin/(protected)/components/AdminPageHeader";
import {
  Button,
  EmptyState,
  InlineCode,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/index.tsx";
import { listMcpServers } from "@/lib/agents/store";
import { appHref } from "@/lib/routing/subdomains.ts";
import Link from "next/link";
import { requireAgentsView } from "../lib/access";

export default async function McpServersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { canEdit } = await requireAgentsView();
  const servers = await listMcpServers();
  const result = paginateAdminItems(servers, (await searchParams).page);

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <AdminPageHeader
        actions={
          canEdit ? (
            <Button asChild>
              <Link href={appHref("/admin/agents/mcp/new")}>New MCP server</Link>
            </Button>
          ) : null
        }
        className="mb-0 shrink-0"
        description="Remote tool servers that agents can call. Only https servers on public addresses are allowed."
        title="MCP servers"
      />
      {servers.length === 0 ? (
        <EmptyState
          description="Add a server, then choose which of its tools an agent may use."
          title="No MCP servers yet"
        />
      ) : (
        <AdminListing
          aria-label="MCP servers"
          pagination={{
            page: result.page,
            pageCount: result.pageCount,
            getPageHref: (page) => adminPageHref("/admin/agents/mcp", page),
            summary: `Showing ${result.start}–${result.end} of ${result.total} MCP servers`,
          }}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Tools</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((server) => (
                <TableRow key={server.id}>
                  <TableCell>
                    <Link
                      className="font-semibold text-primary hover:underline"
                      href={appHref(`/admin/agents/mcp/${server.id}`)}
                    >
                      {server.name}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    <InlineCode>{server.url}</InlineCode>
                  </TableCell>
                  <TableCell>{server.lastCheckedAt ? server.tools.length : "Not checked"}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1.5">
                      <StatusBadge variant={server.enabled ? "success" : "neutral"}>
                        {server.enabled ? "Enabled" : "Disabled"}
                      </StatusBadge>
                      {server.lastError ? <StatusBadge variant="danger">Last check failed</StatusBadge> : null}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </AdminListing>
      )}
    </div>
  );
}
