import { notFound } from "next/navigation";
import { OpenApiImport } from "../../components/OpenApiImport";
import { requireAgentsView } from "../../lib/access";

export default async function ImportOpenApiPage() {
  const { canEdit } = await requireAgentsView();
  if (!canEdit) notFound();
  return <OpenApiImport />;
}
