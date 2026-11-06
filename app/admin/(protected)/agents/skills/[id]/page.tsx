import { getSkill } from "@/lib/agents/store";
import { notFound } from "next/navigation";
import { SkillEditor } from "../../components/SkillEditor";
import { requireAgentsView } from "../../lib/access";

export default async function SkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { canEdit } = await requireAgentsView();
  const { id } = await params;
  const skill = id === "new" ? null : await getSkill(id);
  if (id !== "new" && !skill) notFound();
  return <SkillEditor canEdit={canEdit} key={skill?.id ?? "new"} skill={skill} />;
}
