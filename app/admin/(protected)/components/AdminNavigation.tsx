"use client";

import { SidebarNavItem } from "@/components/ui/index.tsx";
import { cn } from "@/components/ui/lib/utils.ts";
import { appHref, subdomainHref } from "@/lib/routing/subdomains.ts";
import {
  Bot,
  ChevronDown,
  FileText,
  Newspaper,
  Flag,
  History,
  LayoutDashboard,
  Palette,
  Settings,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import { useSelectedLayoutSegments } from "next/navigation";
import { SETTINGS_SECTIONS } from "../settings/lib/sections";

type NavSection = { slug: string; label: string; children?: readonly NavSection[] };

const AGENT_NAV: readonly NavSection[] = [
  { slug: "", label: "Agents" },
  { slug: "skills", label: "Skills" },
  { slug: "mcp", label: "MCP servers" },
  {
    slug: "tools",
    label: "Custom tools",
    children: [
      { slug: "tools", label: "Tools" },
      { slug: "connections", label: "Connections" },
    ],
  },
];

/** Agent pages such as /admin/agents/[id] match no section and fall back to "Agents". */
const agentSectionFor = (child: string | undefined) =>
  AGENT_NAV.find((section) => section.slug === child || section.children?.some((item) => item.slug === child)) ??
  AGENT_NAV[0];

const links = [
  { href: "/admin/tools", label: "Tools catalog", icon: Wrench },
  { href: "/admin/templates", label: "Templates", icon: FileText },
  { href: "/admin/features", label: "Feature flags", icon: Flag },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/roles", label: "Roles", icon: ShieldCheck },
  { href: "/admin/audit", label: "Audit history", icon: History },
  { href: "/admin/design-system", label: "Design system", icon: Palette },
  { href: "/admin/blog", label: "Blog posts", icon: Newspaper },
  { href: "/admin/agents", label: "AI agents", icon: Bot },
  { href: "/admin/settings", label: "Settings", icon: Settings },
] as const;

export function AdminNavigation() {
  const [segment = null, child] = useSelectedLayoutSegments();

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
      {links.map(({ href, icon: Icon, label }) => {
        const active = href === `/admin/${segment}`;
        const isAgents = href === "/admin/agents";
        const sections: readonly NavSection[] =
          active && href === "/admin/settings" ? SETTINGS_SECTIONS : active && isAgents ? AGENT_NAV : [];
        const firstSlug = sections[0]?.slug;
        const activeChild = isAgents ? agentSectionFor(child).slug : child;
        return (
          <div className="contents" key={href}>
            <SidebarNavItem
              active={active && !sections.length}
              aria-expanded={sections.length ? true : undefined}
              className={cn("shrink-0", sections.length && "text-primary [&_svg]:text-primary")}
              href={appHref(firstSlug ? `${href}/${firstSlug}` : href)}
              icon={<Icon aria-hidden="true" />}
            >
              {label}
              {sections.length ? <ChevronDown aria-hidden="true" className="ml-auto hidden lg:block" /> : null}
            </SidebarNavItem>
            {sections.length ? (
              <ul
                aria-label={`${label} sections`}
                className="ml-[21px] hidden flex-col gap-0.5 border-l border-border pl-2 lg:flex"
              >
                {sections.map((section) => {
                  const open = activeChild === section.slug && Boolean(section.children);
                  return (
                    <li key={section.slug}>
                      <SidebarNavItem
                        active={activeChild === section.slug && !open}
                        aria-expanded={open || undefined}
                        className={cn("min-h-8 py-1.5 font-normal", open && "text-primary")}
                        href={appHref(section.slug ? `${href}/${section.slug}` : href)}
                      >
                        {section.label}
                      </SidebarNavItem>
                      {open ? (
                        <ul
                          aria-label={`${section.label} sections`}
                          className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2"
                        >
                          {section.children?.map((item) => (
                            <li key={item.slug}>
                              <SidebarNavItem
                                active={child === item.slug}
                                className="min-h-8 py-1.5 font-normal"
                                href={appHref(`${href}/${item.slug}`)}
                              >
                                {item.label}
                              </SidebarNavItem>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
