import { redirect } from "next/navigation";
import { appHref } from "@/lib/routing/subdomains.ts";

export default function SettingsPage() {
  redirect(appHref("/admin/settings/limits"));
}
