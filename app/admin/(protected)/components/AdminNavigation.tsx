"use client";

import { SidebarNavItem } from "@/components/ui/index.tsx";
import { appHref, subdomainHref } from "@/lib/routing/subdomains.ts";
import { FileText, Newspaper, Flag, History, LayoutDashboard, Palette, Settings, ShieldCheck, Users, Wrench } from "lucide-react";
import { useSelectedLayoutSegment } from "next/navigation";

const links = [
  { href: "/admin/tools", label: "Tools catalog", icon: Wrench },
  { href: "/admin/templates", label: "Templates", icon: FileText },
  { href: "/admin/features", label: "Feature flags", icon: Flag },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/roles", label: "Roles", icon: ShieldCheck },
  { href: "/admin/audit", label: "Audit history", icon: History },
  { href: "/admin/design-system", label: "Design system", icon: Palette },
  { href: "/admin/blog", label: "Blog posts", icon: Newspaper },
  { href: "/admin/settings", label: "Settings", icon: Settings },
] as const;

export function AdminNavigation() {
  const segment = useSelectedLayoutSegment();

  return (
    <nav aria-label="Admin sections" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      <SidebarNavItem
        active={segment === null}
        className="shrink-0"
        href={subdomainHref("admin")}
        icon={<LayoutDashboard aria-hidden="true" />}
      >
        Overview
      </SidebarNavItem>
      {links.map(({ href, icon: Icon, label }) => (
        <SidebarNavItem
          active={href === `/admin/${segment}`}
          className="shrink-0"
          href={appHref(href)}
          icon={<Icon aria-hidden="true" />}
          key={href}
        >
          {label}
        </SidebarNavItem>
      ))}
    </nav>
  );
}
