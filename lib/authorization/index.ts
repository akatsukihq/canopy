export type Access = Record<string, Record<string, boolean>>;

export type Role = {
  id: string;
  name: string;
  description: string;
  access: Access;
  isSystem: boolean;
};

export type User = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  status: "active" | "suspended";
  roles: string[];
};

export type AdminCounts = {
  adminCount: number;
  activeAdminCount: number;
};

type PermissionCatalog = Record<
  string,
  {
    description: string;
    actions: Record<string, { description: string }>;
  }
>;

export const PERMISSION_CATALOG = {
  admin: {
    description: "Access to the Admin application.",
    actions: {
      enter: { description: "Enter and use the Admin application." },
    },
  },
  tools: {
    description: "Tool configuration and availability.",
    actions: {
      view: { description: "View registered tools and their configuration." },
      edit: { description: "Edit tool names, descriptions, slugs, and order." },
      toggle: { description: "Enable or disable tools." },
      archive: { description: "Archive tools so they are no longer available." },
    },
  },
  templates: {
    description: "Invoice template administration.",
    actions: {
      view: { description: "View invoice templates." },
      create: { description: "Create, duplicate, or import invoice templates." },
      edit: { description: "Edit invoice template content and styling." },
      publish: { description: "Publish templates and choose the default." },
      archive: { description: "Archive invoice templates." },
    },
  },
  blog: {
    description: "Blog articles, publishing, and shared categories and tags.",
    actions: {
      view: { description: "View blog drafts, previews, and revision history." },
      create: { description: "Create and duplicate blog articles." },
      edit: { description: "Edit blog drafts, restore revisions, and manage categories and tags." },
      publish: { description: "Publish, schedule, and unpublish blog articles." },
      archive: { description: "Move blog articles to trash and restore them." },
    },
  },
  agents: {
    description: "AI agents, skills, MCP servers, and custom tools used by the assistants.",
    actions: {
      view: { description: "View agent, skill, MCP server, and custom tool configuration." },
      edit: { description: "Create, edit, and delete agents, skills, MCP servers, and custom tools." },
    },
  },
  features: {
    description: "Application feature flags.",
    actions: {
      view: { description: "View registered feature flags." },
      edit: { description: "Edit feature flag metadata." },
      toggle: { description: "Enable or disable feature flags." },
    },
  },
  users: {
    description: "User access and account status.",
    actions: {
      view: { description: "View users and their assigned roles." },
      suspend: { description: "Suspend or reactivate user accounts." },
      assignRoles: { description: "Assign or remove roles for a user." },
    },
  },
  roles: {
    description: "Role definitions and permission grants.",
    actions: {
      view: { description: "View roles and their permissions." },
      create: { description: "Create custom roles." },
      edit: { description: "Edit custom role descriptions and permissions." },
      delete: { description: "Delete unassigned custom roles." },
    },
  },
  settings: {
    description: "Platform settings and system limits.",
    actions: {
      view: { description: "View platform settings and system limits." },
      edit: { description: "Change editable system limits." },
    },
  },
  audit: {
    description: "Privileged action history.",
    actions: {
      view: { description: "View the Admin audit history." },
    },
  },
} as const satisfies PermissionCatalog;

export const ADMIN_ACCESS = freezeAccess({
  admin: { enter: true },
  tools: { view: true, edit: true, toggle: true, archive: true },
  templates: {
    view: true,
    create: true,
    edit: true,
    publish: true,
    archive: true,
  },
  blog: { view: true, create: true, edit: true, publish: true, archive: true },
  agents: { view: true, edit: true },
  features: { view: true, edit: true, toggle: true },
  users: { view: true, suspend: true, assignRoles: true },
  roles: { view: true, create: true, edit: true, delete: true },
  settings: { view: true, edit: true },
  audit: { view: true },
});

const USER_ROLE = Object.freeze<Role>({
  id: "user",
  name: "User",
  description: "Default role assigned to every account. Does not grant access to the Admin application.",
  access: freezeAccess({}),
  isSystem: true,
});

const ADMIN_ROLE = Object.freeze<Role>({
  id: "admin",
  name: "Admin",
  description:
    "Protected operational role for managing SmartTools, users, roles, templates, features, and audit history.",
  access: ADMIN_ACCESS,
  isSystem: true,
});

export const SYSTEM_ROLES: readonly Role[] = Object.freeze([USER_ROLE, ADMIN_ROLE]);

function freezeAccess(access: Access): Access {
  for (const actions of Object.values(access)) Object.freeze(actions);
  return Object.freeze(access);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertValidAccess(access: unknown): asserts access is Access {
  if (!isRecord(access)) throw new Error("Access must be an object.");

  const catalog: PermissionCatalog = PERMISSION_CATALOG;
  for (const [resource, actions] of Object.entries(access)) {
    if (!Object.hasOwn(catalog, resource)) {
      throw new Error(`Unknown permission resource: ${resource}.`);
    }
    if (!isRecord(actions)) {
      throw new Error(`Permissions for ${resource} must be an object.`);
    }

    for (const [action, granted] of Object.entries(actions)) {
      if (!Object.hasOwn(catalog[resource].actions, action)) {
        throw new Error(`Unknown permission: ${resource}.${action}.`);
      }
      if (typeof granted !== "boolean") {
        throw new Error(`Permission ${resource}.${action} must be boolean.`);
      }
    }
  }
}

export function mergeRoleAccess(roles: readonly Pick<Role, "id" | "access">[]): Access {
  const merged: Access = {};

  for (const role of roles) {
    const access = role.id === "admin" ? ADMIN_ACCESS : role.access;
    assertValidAccess(access);
    for (const [resource, actions] of Object.entries(access)) {
      for (const [action, granted] of Object.entries(actions)) {
        if (granted) (merged[resource] ??= {})[action] = true;
      }
    }
  }

  return merged;
}

export function getMissingPermissionPrerequisite(
  access: Access,
  resource: string,
  action: string,
): { resource: string; action: string } | null {
  if (resource === "admin") return null;
  if (access.admin?.enter !== true) return { resource: "admin", action: "enter" };
  if (action !== "view" && access[resource]?.view !== true) {
    return { resource, action: "view" };
  }
  return null;
}

export function assertAccessPrerequisites(access: unknown): asserts access is Access {
  assertValidAccess(access);
  for (const [resource, actions] of Object.entries(access)) {
    for (const [action, granted] of Object.entries(actions)) {
      if (!granted) continue;
      const prerequisite = getMissingPermissionPrerequisite(access, resource, action);
      if (prerequisite) {
        throw new Error(`Permission ${resource}.${action} requires ${prerequisite.resource}.${prerequisite.action}.`);
      }
    }
  }
}

export function hasPermission(access: Access, resource: string, action: string): boolean {
  const catalog: PermissionCatalog = PERMISSION_CATALOG;
  return (
    Object.hasOwn(catalog, resource) &&
    Object.hasOwn(catalog[resource].actions, action) &&
    access[resource]?.[action] === true &&
    getMissingPermissionPrerequisite(access, resource, action) === null
  );
}

function isProtectedRole(role: Pick<Role, "id" | "isSystem">): boolean {
  return role.isSystem || role.id === "user" || role.id === "admin";
}

export function assertCanEditRole(role: Pick<Role, "id" | "isSystem">): void {
  if (isProtectedRole(role)) {
    throw new Error("System roles are protected and cannot be edited.");
  }
}

export function assertCanDeleteRole(role: Pick<Role, "id" | "isSystem">, assignedUserCount: number): void {
  if (isProtectedRole(role)) {
    throw new Error("System roles are protected and cannot be deleted.");
  }
  if (!Number.isInteger(assignedUserCount) || assignedUserCount < 0) {
    throw new Error("Assigned user count must be a non-negative integer.");
  }
  if (assignedUserCount > 0) {
    throw new Error("A role assigned to users cannot be deleted.");
  }
}

function assertValidAdminCounts(counts: AdminCounts): void {
  if (
    !Number.isInteger(counts.adminCount) ||
    counts.adminCount < 0 ||
    !Number.isInteger(counts.activeAdminCount) ||
    counts.activeAdminCount < 0 ||
    counts.activeAdminCount > counts.adminCount
  ) {
    throw new Error("Admin counts must be non-negative integers.");
  }
}

function isAdmin(user: Pick<User, "roles">): boolean {
  return user.roles.includes("admin");
}

function assertAnotherAdminRemains(
  user: Pick<User, "roles" | "status">,
  counts: AdminCounts,
  action: "demote" | "delete",
): void {
  assertValidAdminCounts(counts);
  if (!isAdmin(user)) return;

  if (counts.adminCount <= 1 || (user.status === "active" && counts.activeAdminCount <= 1)) {
    throw new Error(`The final Admin cannot be ${action}d.`);
  }
}

export function assertCanDemoteUser(user: Pick<User, "roles" | "status">, counts: AdminCounts): void {
  assertAnotherAdminRemains(user, counts, "demote");
}

export function assertCanSuspendUser(user: Pick<User, "roles" | "status">, counts: AdminCounts): void {
  assertValidAdminCounts(counts);
  if (isAdmin(user) && user.status === "active" && counts.activeAdminCount <= 1) {
    throw new Error("The final Admin cannot be suspended.");
  }
}

export function assertCanDeleteUser(user: Pick<User, "roles" | "status">, counts: AdminCounts): void {
  assertAnotherAdminRemains(user, counts, "delete");
}
