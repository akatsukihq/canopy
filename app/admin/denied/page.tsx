import { getSession } from "@/lib/auth/session.ts";
import { AuthorizationError, requirePermission } from "@/lib/admin/index.ts";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccessDeniedScreen } from "@/components/account/AccessDeniedScreen";
import { subdomainHref } from "@/lib/routing/subdomains.ts";

export default async function DeniedPage() {
  const session = await getSession(await headers());
  if (!session) redirect(`/auth?${new URLSearchParams({ returnTo: subdomainHref("admin") })}`);

  // Access was granted since the redirect here: send them back to Admin, not a dead end.
  const hasAccess = await requirePermission(session.user.id, "admin", "enter").then(
    () => true,
    (error: unknown) => {
      if (error instanceof AuthorizationError) return false;
      throw error;
    },
  );
  if (hasAccess) redirect(subdomainHref("admin"));

  return <AccessDeniedScreen user={session.user} />;
}
