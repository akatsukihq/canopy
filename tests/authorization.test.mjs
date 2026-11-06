import { expect, test } from "vitest";
import {
  ADMIN_ACCESS,
  PERMISSION_CATALOG,
  SYSTEM_ROLES,
  assertCanDeleteRole,
  assertCanDeleteUser,
  assertCanDemoteUser,
  assertCanEditRole,
  assertCanSuspendUser,
  assertAccessPrerequisites,
  assertValidAccess,
  getMissingPermissionPrerequisite,
  hasPermission,
  mergeRoleAccess,
} from "../lib/authorization/index.ts";

const USER_DESCRIPTION = "Default role assigned to every account. Does not grant access to the Admin application.";
const ADMIN_DESCRIPTION =
  "Protected operational role for managing SmartTools, users, roles, templates, features, and audit history.";

function customRole(overrides = {}) {
  return {
    id: "template-editor",
    name: "Template editor",
    description: "Manages invoice templates.",
    access: { templates: { view: true, edit: true } },
    isSystem: false,
    ...overrides,
  };
}

function user(overrides = {}) {
  return {
    id: "user-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    image: null,
    status: "active",
    roles: ["user"],
    ...overrides,
  };
}

test("system roles match the protected user and admin contracts", () => {
  expect(SYSTEM_ROLES).toEqual([
    {
      id: "user",
      name: "User",
      description: USER_DESCRIPTION,
      access: {},
      isSystem: true,
    },
    {
      id: "admin",
      name: "Admin",
      description: ADMIN_DESCRIPTION,
      access: ADMIN_ACCESS,
      isSystem: true,
    },
  ]);
  expect(ADMIN_ACCESS).toEqual({
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
  expect(Object.isFrozen(SYSTEM_ROLES)).toBe(true);
  expect(Object.isFrozen(ADMIN_ACCESS.templates)).toBe(true);
});

test("system Admin uses current built-in grants even when stored grants predate Blog", () => {
  const legacyAccess = { ...ADMIN_ACCESS };
  delete legacyAccess.blog;
  const admin = customRole({ id: "admin", isSystem: true, access: legacyAccess });
  const access = mergeRoleAccess([admin]);
  expect(access).toEqual(ADMIN_ACCESS);
  for (const action of Object.keys(PERMISSION_CATALOG.blog.actions)) {
    expect(hasPermission(access, "blog", action)).toBe(true);
  }
  expect(hasPermission(mergeRoleAccess([customRole({ name: "Admin", access: legacyAccess })]), "blog", "view")).toBe(
    false,
  );
  expect(legacyAccess.blog, "stored grants are not mutated").toBe(undefined);
});

test("every supported permission has resource and action help text", () => {
  expect(Object.keys(PERMISSION_CATALOG)).toEqual([
    "admin",
    "tools",
    "templates",
    "blog",
    "agents",
    "features",
    "users",
    "roles",
    "settings",
    "audit",
  ]);

  for (const resource of Object.values(PERMISSION_CATALOG)) {
    expect(resource.description.trim()).toBeTruthy();
    for (const action of Object.values(resource.actions)) {
      expect(action.description.trim()).toBeTruthy();
    }
  }
});

test("multiple roles combine only positive grants and missing grants deny", () => {
  const viewer = customRole({
    id: "viewer",
    access: { admin: { enter: true }, tools: { view: true, edit: false } },
  });
  const editor = customRole({
    id: "editor",
    access: { tools: { edit: true }, templates: { view: true } },
  });

  const access = mergeRoleAccess([viewer, editor]);

  expect(access).toEqual({
    admin: { enter: true },
    tools: { view: true, edit: true },
    templates: { view: true },
  });
  expect(hasPermission(access, "tools", "view")).toBe(true);
  expect(hasPermission(access, "tools", "archive")).toBe(false);
  expect(hasPermission(access, "tools", "launch")).toBe(false);
  expect(hasPermission(access, "missing", "view")).toBe(false);
  expect(viewer.access.tools.edit).toBe(false);
});

test("access validation rejects malformed and unknown permissions", () => {
  expect(() => assertValidAccess({ tools: { view: true, edit: false } })).not.toThrow();
  expect(() => assertValidAccess({ billing: { view: true } })).toThrow(/Unknown permission resource: billing/);
  expect(() => assertValidAccess({ tools: { launch: true } })).toThrow(/Unknown permission: tools\.launch/);
  expect(() => assertValidAccess({ tools: { view: "yes" } })).toThrow(/Permission tools\.view must be boolean/);
  expect(() => assertValidAccess({ tools: null })).toThrow(/Permissions for tools must be an object/);
  expect(() => assertValidAccess(null)).toThrow(/Access must be an object/);
  expect(() => mergeRoleAccess([customRole({ access: { tools: { launch: true } } })])).toThrow(
    /Unknown permission: tools\.launch/,
  );
});

test("permission prerequisites apply to effective grants without silently granting access", () => {
  expect(getMissingPermissionPrerequisite({}, "tools", "edit")).toEqual({
    resource: "admin",
    action: "enter",
  });
  expect(getMissingPermissionPrerequisite({ admin: { enter: true } }, "tools", "edit")).toEqual({
    resource: "tools",
    action: "view",
  });
  expect(getMissingPermissionPrerequisite({}, "admin", "enter")).toBe(null);
  for (const [resource, { actions }] of Object.entries(PERMISSION_CATALOG)) {
    for (const action of Object.keys(actions)) {
      expect(hasPermission(ADMIN_ACCESS, resource, action)).toBe(true);
      if (resource === "admin") continue;
      expect(hasPermission({ [resource]: { view: true, [action]: true } }, resource, action)).toBe(false);
      if (action !== "view") {
        expect(hasPermission({ admin: { enter: true }, [resource]: { [action]: true } }, resource, action)).toBe(false);
      }
    }
  }
  expect(() => assertAccessPrerequisites({ tools: { view: true } })).toThrow(/tools.view requires admin.enter/);
  expect(() => assertAccessPrerequisites({ admin: { enter: true }, tools: { edit: true } })).toThrow(
    /tools.edit requires tools.view/,
  );
  expect(() => assertAccessPrerequisites({ tools: { view: "true" } })).toThrow(/must be boolean/);
  expect(() => assertAccessPrerequisites({ tools: { edit: false } })).not.toThrow();
  expect(() => assertAccessPrerequisites({})).not.toThrow();
  expect(() => assertAccessPrerequisites(ADMIN_ACCESS)).not.toThrow();
  const fragments = [
    { access: { admin: { enter: true } } },
    { access: { tools: { view: true } } },
    { access: { tools: { edit: true } } },
  ];
  const combined = mergeRoleAccess(fragments);
  expect(() => assertAccessPrerequisites(combined)).not.toThrow();
  expect(hasPermission(combined, "tools", "edit")).toBe(true);
  expect(hasPermission(combined, "tools", "archive")).toBe(false);
  expect(fragments[2].access).toEqual({ tools: { edit: true } });
});

test("protected roles cannot be edited or deleted and assigned custom roles cannot be deleted", () => {
  for (const id of ["user", "admin"]) {
    const protectedRole = customRole({ id, isSystem: false });
    expect(() => assertCanEditRole(protectedRole)).toThrow(/protected/);
    expect(() => assertCanDeleteRole(protectedRole, 0)).toThrow(/protected/);
  }

  const assignedRole = customRole();
  expect(() => assertCanEditRole(assignedRole)).not.toThrow();
  expect(() => assertCanEditRole(customRole({ isSystem: true }))).toThrow(/protected/);
  expect(() => assertCanDeleteRole(assignedRole, 1)).toThrow(/assigned to users/);
  expect(() => assertCanDeleteRole(assignedRole, 0)).not.toThrow();
});

test("the final active admin cannot be demoted, suspended, or deleted", () => {
  const finalAdmin = user({ roles: ["user", "admin"] });
  const counts = { adminCount: 1, activeAdminCount: 1 };

  expect(() => assertCanDemoteUser(finalAdmin, counts)).toThrow(/final Admin/);
  expect(() => assertCanSuspendUser(finalAdmin, counts)).toThrow(/final Admin/);
  expect(() => assertCanDeleteUser(finalAdmin, counts)).toThrow(/final Admin/);

  const multipleAdmins = { adminCount: 2, activeAdminCount: 2 };
  expect(() => assertCanDemoteUser(finalAdmin, multipleAdmins)).not.toThrow();
  expect(() => assertCanSuspendUser(finalAdmin, multipleAdmins)).not.toThrow();
  expect(() => assertCanDeleteUser(finalAdmin, multipleAdmins)).not.toThrow();
  expect(() => assertCanDeleteUser(user(), counts)).not.toThrow();
});

test("an inactive backup admin does not permit removal of the final active admin", () => {
  const activeAdmin = user({ roles: ["admin"] });
  const counts = { adminCount: 2, activeAdminCount: 1 };

  expect(() => assertCanDemoteUser(activeAdmin, counts)).toThrow(/final Admin/);
  expect(() => assertCanSuspendUser(activeAdmin, counts)).toThrow(/final Admin/);
  expect(() => assertCanDeleteUser(activeAdmin, counts)).toThrow(/final Admin/);
});

test("a suspended final admin remains protected from demotion and deletion", () => {
  const suspendedAdmin = user({ status: "suspended", roles: ["admin"] });
  const counts = { adminCount: 1, activeAdminCount: 0 };

  expect(() => assertCanDemoteUser(suspendedAdmin, counts)).toThrow(/final Admin/);
  expect(() => assertCanSuspendUser(suspendedAdmin, counts)).not.toThrow();
  expect(() => assertCanDeleteUser(suspendedAdmin, counts)).toThrow(/final Admin/);
});

test("invalid role and admin counts fail closed", () => {
  expect(() => assertCanDeleteRole(customRole(), -1)).toThrow(/Assigned user count must be a non-negative integer/);
  expect(() =>
    assertCanSuspendUser(user({ roles: ["admin"] }), {
      adminCount: 1,
      activeAdminCount: Number.NaN,
    }),
  ).toThrow(/Admin counts must be non-negative integers/);
  expect(() =>
    assertCanSuspendUser(user({ roles: ["admin"] }), {
      adminCount: 1,
      activeAdminCount: 2,
    }),
  ).toThrow(/Admin counts must be non-negative integers/);
});
