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
import { codeExecutionConfigured, needsCodeExecution } from "@/lib/agents/toolRuntime";
import { listTools } from "@/lib/agents/toolStore";
import { customToolName } from "@/lib/agents/toolTypes.ts";
import { appHref } from "@/lib/routing/subdomains.ts";
import Link from "next/link";
import { requireAgentsView } from "../lib/access";

export default async function CustomToolsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { canEdit } = await requireAgentsView();
  const tools = (await listTools()).filter((tool) => !tool.connectionId);
  const codeReady = codeExecutionConfigured();
  const result = paginateAdminItems(tools, (await searchParams).page);

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <AdminPageHeader
        actions={
          canEdit ? (
            <Button asChild>
              <Link href={appHref("/admin/agents/tools/new")}>New custom tool</Link>
            </Button>
          ) : null
        }
        className="mb-0 shrink-0"
        description="Your own standalone HTTP and code tools. Endpoints of a shared API live under Connections."
        title="Custom tools"
      />
      {tools.length === 0 ? (
        <EmptyState
          description="Create a tool, test it, then attach it to agents. For an API with many endpoints, add a connection instead."
          title="No custom tools yet"
        />
      ) : (
        <AdminListing
          aria-label="Custom tools"
          pagination={{
            page: result.page,
            pageCount: result.pageCount,
            getPageHref: (page) => adminPageHref("/admin/agents/tools", page),
            summary: `Showing ${result.start}–${result.end} of ${result.total} custom tools`,
          }}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Model-facing name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((tool) => (
                <TableRow key={tool.id}>
                  <TableCell>
                    <Link
                      className="font-semibold text-primary hover:underline"
                      href={appHref(`/admin/agents/tools/${tool.id}`)}
                    >
                      {tool.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <InlineCode>{customToolName(tool.key)}</InlineCode>
                  </TableCell>
                  <TableCell>{tool.kind === "http" ? `HTTP ${tool.http?.method ?? ""}` : "Code"}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1.5">
                      <StatusBadge variant={tool.enabled ? "success" : "neutral"}>
                        {tool.enabled ? "Enabled" : "Disabled"}
                      </StatusBadge>
                      {tool.requiresApproval ? <StatusBadge variant="warning">Needs approval</StatusBadge> : null}
                      {!codeReady && needsCodeExecution(tool) ? (
                        <StatusBadge variant="danger">Unavailable: code execution off</StatusBadge>
                      ) : null}
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
