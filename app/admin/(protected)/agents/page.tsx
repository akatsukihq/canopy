import { AdminListing } from "@/app/admin/(protected)/components/AdminListing";
import { adminPageHref, paginateAdminItems } from "@/app/admin/(protected)/lib/pagination";
import { AdminPageHeader } from "@/app/admin/(protected)/components/AdminPageHeader";
import {
  Button,
  Caption,
  InlineCode,
  EmptyState,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/index.tsx";
import { listAgents } from "@/lib/agents/store";
import { AGENT_SECTION_LABELS, type Agent } from "@/lib/agents/types.ts";
import { appHref } from "@/lib/routing/subdomains.ts";
import Link from "next/link";
import { requireAgentsView } from "./lib/access";

function outputLabel(agent: Agent): string {
  if (agent.proposesDocument) return "Article changes";
  return agent.outputSchema ? "Structured" : "Text";
}

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const { canEdit } = await requireAgentsView();
  const agents = await listAgents();
  const result = paginateAdminItems(agents, (await searchParams).page);
  const pipelineSteps = new Set(agents.flatMap((agent) => agent.subagents.agentIds));

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <AdminPageHeader
        actions={
          canEdit ? (
            <Button asChild>
              <Link href={appHref("/admin/agents/new")}>New agent</Link>
            </Button>
          ) : null
        }
        className="mb-0 shrink-0"
        description="Configure the assistants people can run in the blog editor and other sections."
        title="Agents"
      />
      {agents.length === 0 ? (
        <EmptyState
          description="Create an agent to make it available in the sections you choose."
          title="No agents yet"
        />
      ) : (
        <AdminListing
          aria-label="agents"
          pagination={{
            page: result.page,
            pageCount: result.pageCount,
            getPageHref: (page) => adminPageHref("/admin/agents", page),
            summary: `Showing ${result.start}–${result.end} of ${result.total} agents`,
          }}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Used in</TableHead>
                <TableHead>Output</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((agent) => (
                <TableRow key={agent.id}>
                  <TableCell className="max-w-[360px] whitespace-normal">
                    <span className="flex items-center gap-2">
                      <Link
                        className="font-semibold text-primary hover:underline"
                        href={appHref(`/admin/agents/${agent.id}`)}
                      >
                        {agent.name}
                      </Link>
                      {agent.command ? <InlineCode>{`/${agent.command}`}</InlineCode> : null}
                    </span>
                    <Caption className="mt-0.5 line-clamp-1 text-muted-foreground">{agent.description}</Caption>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="flex flex-wrap gap-1.5">
                      {agent.sections.map((section) => (
                        <StatusBadge key={section} variant="neutral">
                          {AGENT_SECTION_LABELS[section]}
                        </StatusBadge>
                      ))}
                      {!agent.sections.length ? (
                        <Caption className="text-muted-foreground">
                          {pipelineSteps.has(agent.id) ? "Step in another agent" : "Nowhere yet"}
                        </Caption>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>{outputLabel(agent)}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1.5">
                      <StatusBadge variant={agent.enabled ? "success" : "neutral"}>
                        {agent.enabled ? "Enabled" : "Disabled"}
                      </StatusBadge>
                      {agent.defaultFor.length ? <StatusBadge variant="info">Default</StatusBadge> : null}
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
