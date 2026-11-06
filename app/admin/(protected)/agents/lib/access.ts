import { getUserAuthorization } from "@/lib/admin/index.ts";
import { hasPermission } from "@/lib/authorization/index.ts";
import { requirePagePermission } from "@/lib/admin/access";

/** Guards an agents page and reports whether the viewer may also edit. */
export async function requireAgentsView(): Promise<{ canEdit: boolean }> {
  const session = await requirePagePermission("agents", "view");
  const { access } = await getUserAuthorization(session.user.id);
  return { canEdit: hasPermission(access, "agents", "edit") };
}
