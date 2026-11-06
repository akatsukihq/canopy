import { AdminListing } from "@/app/admin/(protected)/components/AdminListing";
import { adminPageHref, paginateAdminItems } from "@/app/admin/(protected)/lib/pagination";
import { AdminPageHeader } from "@/app/admin/(protected)/components/AdminPageHeader";
import {
  Button,
  Caption,
  InlineCode,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/index.tsx";
import { listSkills } from "@/lib/agents/store";
import { appHref } from "@/lib/routing/subdomains.ts";
import Link from "next/link";
import { requireAgentsView } from "../lib/access";

export default async function SkillsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const { canEdit } = await requireAgentsView();
  const skills = await listSkills();
  const result = paginateAdminItems(skills, (await searchParams).page);

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <AdminPageHeader
        actions={
          canEdit ? (
            <Button asChild>
              <Link href={appHref("/admin/agents/skills/new")}>New skill</Link>
            </Button>
          ) : null
        }
        className="mb-0 shrink-0"
        description="Reusable instructions. Agents always see a skill's description and load the full text only when needed."
        title="Skills"
      />
      {skills.length === 0 ? (
        <EmptyState description="Create a skill, then attach it to agents." title="No skills yet" />
      ) : (
        <AdminListing
          aria-label="skills"
          pagination={{
            page: result.page,
            pageCount: result.pageCount,
            getPageHref: (page) => adminPageHref("/admin/agents/skills", page),
            summary: `Showing ${result.start}–${result.end} of ${result.total} skills`,
          }}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((skill) => (
                <TableRow key={skill.id}>
                  <TableCell>
                    <Link
                      className="font-semibold text-primary hover:underline"
                      href={appHref(`/admin/agents/skills/${skill.id}`)}
                    >
                      {skill.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <InlineCode>{skill.key}</InlineCode>
                  </TableCell>
                  <TableCell>
                    <Caption className="line-clamp-2 max-w-xl whitespace-normal text-muted-foreground">
                      {skill.description}
                    </Caption>
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
