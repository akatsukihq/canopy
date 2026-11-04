import config from "../config/config.ts";
import { withPdfmeTextFormatting } from "../invoice-templates/pdfmeTextFormatting.ts";
import { getPaperworkToolMessages } from "../paperwork/toolMessages.ts";
import { withUserCacheInvalidation } from "./index.ts";
import {
  assertCanDeleteRole,
  assertCanDemoteUser,
  assertCanEditRole,
  assertCanSuspendUser,
  assertAccessPrerequisites,
  assertValidAccess,
  hasPermission,
  mergeRoleAccess,
  type Access,
  type Role,
  type User,
} from "../authorization/index.ts";
import {
  and,
  auditEventsTable,
  authSession,
  authUser,
  db,
  eq,
  featureOverridesTable,
  inArray,
  invoiceTemplatesTable,
  managedToolsTable,
  ne,
  rolesTable,
  toolContentTable,
  userRolesTable,
} from "../../db/index.ts";
import {
  createAdvancedTemplateConfig,
  DocumentTemplateSchema,
  normalizeAdvancedTemplateConfig,
  validateAdvancedTemplateForPublish,
  type AdvancedDocumentTemplate,
  type DocumentTemplate,
  type InvoiceTemplate,
  type TemplateDocumentType,
  type TemplatePageFormat,
} from "../invoice-templates/index.ts";
import {
  assertToolSlugImmutable,
  isValidToolSlug,
  slugFromName,
  TOOL_SLUG_PATTERN,
  type ManagedTool,
  type ToolApp,
} from "../tool-catalog/index.ts";
import { AuthorizationError, type FeatureApp, type FeatureManifestEntry } from "./index.ts";
import { z } from "zod";
import { Cache, CACHE_NAMESPACES } from "../cache/index.ts";
import { catalogCache } from "../tool-framework/catalogCache.ts";
import { isCategoryKey, TOOL_CATEGORIES, type CategoryKey } from "../tool-framework/categories.ts";
import {
  hasDraftToolContent,
  resolveContent,
  TOOL_CONTENT_DOC_VERSION,
  type ToolContentRow,
} from "../tool-framework/content.ts";
import { uploadToolIcon } from "../tool-framework/cloudinary.ts";
import { cloudinaryCredentials } from "../config/integrations.ts";
import { definitionKeyOf, specFromRow } from "../tool-framework/catalog.ts";
import { parseToolSpec } from "../tool-framework/specSchema.ts";
import { limitViolations, loadSystemLimits } from "../tool-framework/systemLimits.ts";
import {
  applyToolMessages,
  escapeToolText,
  extractToolMessages,
  formatToolMessage,
  validateToolTranslation,
  type ToolTranslations,
} from "../tool-framework/translations.ts";
import { isLocale } from "../i18n/config.ts";
import type { ToolSpec } from "../tool-framework/spec.ts";

export async function invalidateAfterCommit<T>(namespace: string, result: T): Promise<T> {
  if (namespace === CACHE_NAMESPACES.CATALOG) catalogCache.clear();
  else await new Cache(namespace).delete("all");
  return result;
}

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ToolRow = typeof managedToolsTable.$inferSelect;
type RoleRow = typeof rolesTable.$inferSelect;
type TemplateRow = typeof invoiceTemplatesTable.$inferSelect;

export type ManagedToolEdit = Partial<Pick<ManagedTool, "slug" | "name" | "description">>;

export type FeatureEdit = {
  name?: string;
  description?: string;
};

export type CustomRoleEdit = {
  name?: string;
  description?: string;
  access?: Access;
};

export type InvoiceTemplateContent = Pick<
  InvoiceTemplate,
  "name" | "slug" | "description" | "category" | "layoutFamily" | "config"
>;

export type DocumentTemplateContent = Pick<
  DocumentTemplate,
  "name" | "slug" | "description" | "category" | "layoutFamily" | "config"
>;

export type AdvancedDocumentTemplateDraft = Pick<
  AdvancedDocumentTemplate,
  "name" | "slug" | "description" | "category"
> & {
  documentType: TemplateDocumentType;
  pageFormat: TemplatePageFormat;
};

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PARTS = new Set([
  "auth",
  "authentication",
  "authorization",
  "cookie",
  "password",
  "passwd",
  "secret",
  "token",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((part) => SENSITIVE_KEY_PARTS.has(part));
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return REDACTED;
    seen.add(value);
    return value.map((item) => redactValue(item, seen));
  }
  if (!isRecord(value)) return value;
  if (seen.has(value)) return REDACTED;

  seen.add(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      isSensitiveKey(key) ? REDACTED : redactValue(nestedValue, seen),
    ]),
  );
}

export function redactAuditMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return redactValue(metadata, new WeakSet()) as Record<string, unknown>;
}

function requiredText(value: unknown, label: string, maxLength = 2_000): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }
  return trimmed;
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
}

export async function requireTransactionPermission(
  transaction: Transaction,
  actorUserId: string,
  resource: string,
  action: string,
): Promise<void> {
  const rows = await transaction
    .select({
      status: authUser.status,
      roleId: rolesTable.id,
      roleName: rolesTable.name,
      roleDescription: rolesTable.description,
      roleAccess: rolesTable.access,
      roleIsSystem: rolesTable.isSystem,
    })
    .from(authUser)
    .innerJoin(userRolesTable, eq(userRolesTable.userId, authUser.id))
    .innerJoin(rolesTable, eq(rolesTable.id, userRolesTable.roleId))
    .where(eq(authUser.id, actorUserId))
    .for("share");

  if (!rows.length || rows[0].status !== "active") {
    throw new AuthorizationError("Access denied");
  }

  const roles: Role[] = rows.flatMap((row) =>
    row.roleId && row.roleName && row.roleDescription && row.roleAccess && row.roleIsSystem !== null
      ? [
          {
            id: row.roleId,
            name: row.roleName,
            description: row.roleDescription,
            access: row.roleAccess,
            isSystem: row.roleIsSystem,
          },
        ]
      : [],
  );

  const access = mergeRoleAccess(roles);
  if (!hasPermission(access, "admin", "enter")) {
    throw new AuthorizationError("Missing permission: admin.enter");
  }
  if (!hasPermission(access, resource, action)) {
    throw new AuthorizationError(`Missing permission: ${resource}.${action}`);
  }
}

export async function writeAudit(
  transaction: Transaction,
  actorUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await transaction.insert(auditEventsTable).values({
    id: crypto.randomUUID(),
    actorUserId,
    action,
    targetType,
    targetId,
    metadata: redactAuditMetadata(metadata),
  });
}

/**
 * The row is the tool. There is no bundled list to fall back to, so a tool id
 * with no `managed_tools` row does not exist — which is also what makes a row
 * created before its folder ships fully manageable here.
 */
export async function getToolForUpdate(transaction: Transaction, toolId: string): Promise<ToolRow> {
  const [stored] = await transaction
    .select()
    .from(managedToolsTable)
    .where(eq(managedToolsTable.toolId, toolId))
    .limit(1)
    .for("update");

  if (!stored) throw new Error(`Unknown tool: ${toolId}.`);
  return stored;
}

async function saveTool(
  transaction: Transaction,
  tool: Pick<ToolRow, "toolId" | "app" | "slug" | "name" | "description" | "order" | "enabled" | "archived"> &
    Partial<Pick<ToolRow, "translations">>,
): Promise<ToolRow> {
  const now = new Date();
  const [saved] = await transaction
    .insert(managedToolsTable)
    .values({ ...tool, updatedAt: now })
    .onConflictDoUpdate({
      target: managedToolsTable.toolId,
      set: {
        slug: tool.slug,
        name: tool.name,
        description: tool.description,
        order: tool.order,
        enabled: tool.enabled,
        archived: tool.archived,
        ...(tool.translations ? { translations: tool.translations } : {}),
        updatedAt: now,
      },
    })
    .returning();
  return saved;
}

/** Existing content controls remain the owner of source structure and ordering. */
export function toolTranslationSource(
  spec: ToolSpec | null,
  tool: Pick<ToolRow, "name" | "description"> & Partial<Pick<ToolRow, "app" | "toolId">>,
  content: ToolContentRow | null,
): Record<string, string> {
  if (!spec)
    return {
      name: escapeToolText(tool.name),
      description: escapeToolText(tool.description),
      ...(tool.app === "paperwork" && tool.toolId
        ? getPaperworkToolMessages(definitionKeyOf(tool.toolId) ?? tool.toolId)
        : {}),
    };
  const resolved = resolveContent({ ...spec, name: tool.name, description: tool.description }, content);
  return extractToolMessages(
    { ...spec, name: tool.name, description: tool.description, keywords: resolved.keywords, content: resolved.content },
    { seoTitle: resolved.seoTitle, seoDescription: resolved.seoDescription },
  );
}

function replaceEnglishMessages(translations: ToolTranslations, messages: Record<string, string>): ToolTranslations {
  const previous = translations.en?.messages ?? {};
  const changed = JSON.stringify(Object.entries(previous).sort()) !== JSON.stringify(Object.entries(messages).sort());
  return Object.fromEntries([
    ...Object.entries(translations)
      .filter(([locale]) => locale !== "en")
      .map(([locale, entry]) => [locale, changed ? { ...entry, status: "draft" as const } : entry]),
    ["en", { status: translations.en?.status ?? "published", messages }],
  ]);
}

export function synchronizeEnglishSource(
  translations: ToolTranslations,
  before: Record<string, string>,
  after: Record<string, string>,
): ToolTranslations {
  const messages = { ...translations.en?.messages };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] === after[key]) continue;
    if (after[key] === undefined) delete messages[key];
    else messages[key] = after[key];
  }
  return replaceEnglishMessages(translations, messages);
}

async function syncContentEnglish(
  transaction: Transaction,
  tool: ToolRow,
  previous: ToolContentRow | null,
  next: ToolContentRow | null,
): Promise<void> {
  if (!tool.translations?.en) return;
  const spec = await specFromRow(tool);
  const before = toolTranslationSource(spec, tool, previous);
  const after = toolTranslationSource(spec, tool, next);
  await transaction
    .update(managedToolsTable)
    .set({
      translations: synchronizeEnglishSource(tool.translations, before, after),
      updatedAt: new Date(),
    })
    .where(eq(managedToolsTable.toolId, tool.toolId));
}

export class ToolSpecValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Tool spec needs attention: ${issues[0] ?? "invalid spec"}`);
  }
}

/** A spec an admin may store for `tool`: schema-valid, its own id/app, and within system limits. */
export async function validatedToolSpec(value: unknown, tool: Pick<ToolRow, "toolId" | "app">): Promise<ToolSpec> {
  const parsed = parseToolSpec(value);
  if (!parsed.ok) throw new ToolSpecValidationError(parsed.issues);
  const issues = [
    ...(parsed.spec.toolId === tool.toolId ? [] : [`toolId: must be "${tool.toolId}"`]),
    ...(parsed.spec.app === tool.app ? [] : [`app: must be "${tool.app}"`]),
    ...limitViolations(parsed.spec, await loadSystemLimits()),
  ];
  if (issues.length) throw new ToolSpecValidationError(issues);
  return parsed.spec;
}

export class ToolTranslationValidationError extends Error {
  constructor(readonly issues: readonly { key: string; message: string }[]) {
    super(`Translation needs attention: ${issues[0]?.message ?? "invalid messages"}`);
  }
}

export async function saveToolTranslation(
  actorUserId: string,
  toolId: string,
  input: { locale: string; status: "draft" | "published"; messages: Record<string, string>; updatedAt: string },
): Promise<{ updatedAt: string; status: "draft" | "published"; sourceChanged: boolean }> {
  return db
    .transaction(async (transaction) => {
      await requireTransactionPermission(transaction, actorUserId, "tools", "edit");
      if (!isRecord(input) || !isLocale(input.locale) || !["draft", "published"].includes(input.status)) {
        throw new Error("Translation language or status is invalid.");
      }
      const current = await getToolForUpdate(transaction, toolId);
      if (typeof input.updatedAt !== "string" || current.updatedAt.toISOString() !== input.updatedAt) {
        throw new Error("This tool changed after you opened it. Reload the page before saving again.");
      }
      if (input.status === "published" || current.translations?.[input.locale]?.status === "published") {
        await requireTransactionPermission(transaction, actorUserId, "tools", "toggle");
      }
      if (input.locale === "en" && current.enabled && input.status !== "published") {
        throw new Error("English must remain published while the tool is enabled.");
      }
      let englishMessages = current.translations?.en?.messages;
      const spec = await specFromRow(current);
      let contentRow: ToolContentRow | null = null;
      if (spec || !englishMessages) {
        const [content] = await transaction
          .select()
          .from(toolContentTable)
          .where(eq(toolContentTable.toolId, toolId))
          .limit(1)
          .for("update");
        contentRow = content ?? null;
      }
      const required = toolTranslationSource(spec, current, contentRow);
      englishMessages =
        input.locale === "en"
          ? required
          : Object.fromEntries(
              Object.entries(required).map(([key, source]) => [key, englishMessages?.[key] ?? source]),
            );
      const issues = validateToolTranslation(input.locale, input.messages, englishMessages, {
        publish: input.status === "published",
      });
      if (issues.length) throw new ToolTranslationValidationError(issues);
      const messages = Object.fromEntries(Object.entries(input.messages).filter(([, value]) => value.trim()));
      const sourceChanged =
        input.locale === "en" &&
        JSON.stringify(Object.entries(current.translations?.en?.messages ?? {}).sort()) !==
          JSON.stringify(Object.entries(messages).sort());
      let translations: ToolTranslations = {
        ...current.translations,
        en: current.translations?.en ?? { status: "published", messages: englishMessages },
        [input.locale]: { status: input.status, messages },
      };
      if (input.locale === "en") {
        translations = replaceEnglishMessages(
          { ...translations, en: current.translations?.en ?? { status: "published", messages: {} } },
          messages,
        );
        translations.en = { status: input.status, messages };
      }
      const now = new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1));
      await transaction
        .update(managedToolsTable)
        .set({
          translations,
          ...(input.locale === "en"
            ? {
                name: messages.name ? formatToolMessage("en", messages.name) : current.name,
                description: messages.description ? formatToolMessage("en", messages.description) : current.description,
              }
            : {}),
          updatedAt: now,
        })
        .where(eq(managedToolsTable.toolId, toolId));
      // An authored content draft has its own publication workflow. The runtime
      // reads English from translations, so mirroring must not consume that draft.
      if (input.locale === "en" && spec && !hasDraftToolContent(contentRow)) {
        const resolved = resolveContent({ ...spec, name: current.name, description: current.description }, contentRow);
        const translated = applyToolMessages(
          { ...spec, keywords: resolved.keywords, content: resolved.content },
          messages,
          "en",
        );
        const values = {
          keywords: [...translated.keywords],
          seoTitle: messages.seoTitle ? formatToolMessage("en", messages.seoTitle) : resolved.seoTitle,
          seoDescription: messages.seoDescription
            ? formatToolMessage("en", messages.seoDescription)
            : resolved.seoDescription,
          contentDoc: { version: TOOL_CONTENT_DOC_VERSION, ...translated.content },
          docVersion: TOOL_CONTENT_DOC_VERSION,
          publishedAt: input.status === "published" ? now : null,
          updatedAt: now,
        };
        await transaction
          .insert(toolContentTable)
          .values({ toolId, ...values })
          .onConflictDoUpdate({ target: toolContentTable.toolId, set: values });
      }
      await writeAudit(transaction, actorUserId, "tool.translation-edit", "tool", toolId, {
        locale: input.locale,
        status: input.status,
        messageCount: Object.keys(messages).length,
      });
      return { updatedAt: now.toISOString(), status: input.status, sourceChanged };
    })
    .then((result) => invalidateAfterCommit(CACHE_NAMESPACES.CATALOG, result));
}

/**
 * The database half of a tool, created before its folder exists.
 *
 * A tool is two halves: a `managed_tools` row holding its spec, and a run file
 * in `tools/<key>/` (shipped by a deploy — a deployed app cannot write files).
 * This creates the row only. `catalog.ts` drops any row without a valid stored
 * spec, so a row with no spec yet is invisible to visitors rather than a 404.
 *
 * The one irreversible field is the slug: `prevent_saved_tool_slug_change`,
 * `assertToolSlugImmutable` and `unique(app, slug)` freeze it.
 */
export interface ManagedToolDraft {
  readonly app: string;
  /** The folder under `tools/`, and the second half of the tool id. */
  readonly key: string;
  readonly name: string;
  readonly description: string;
  /** Blank falls back to `slugFromName(name)`. */
  readonly slug?: string;
  readonly category: string;
  /** Optional initial spec (untrusted JSON), stored as the unpublished draft. */
  readonly spec?: unknown;
}

/** Paperwork is a separate product surface and is not scaffolded this way. */
type CreatableToolApp = "devtools" | "media";

function creatableApp(value: unknown): CreatableToolApp {
  if (value !== "devtools" && value !== "media") {
    throw new Error('Tool app must be "devtools" or "media".');
  }
  return value;
}

export async function createManagedTool(actorUserId: string, input: ManagedToolDraft): Promise<ToolRow> {
  return db
    .transaction(async (transaction) => {
      await requireTransactionPermission(transaction, actorUserId, "tools", "edit");
      if (!isRecord(input)) throw new Error("Tool details must be an object.");

      const app = creatableApp(input.app);
      const key = requiredText(input.key, "Folder key", 80);
      if (!TOOL_SLUG_PATTERN.test(key)) {
        throw new Error("Folder key must be lowercase words joined by single hyphens.");
      }
      const name = requiredText(input.name, "Tool name", 160);
      const description = requiredText(input.description, "Tool description");

      const category = requiredText(input.category, "Tool category", 64);
      if (!isCategoryKey(category) || TOOL_CATEGORIES[category].app !== app) {
        throw new Error(`Tool category is not registered for ${app}.`);
      }

      // The picker shows this live, but the default is recomputed here so a
      // hand-posted form cannot slip a slug past it.
      const requested = typeof input.slug === "string" ? input.slug.trim() : "";
      const slug = requested || slugFromName(name);
      if (!isValidToolSlug(app, slug)) {
        throw new Error("Tool slug is invalid or reserved.");
      }

      // The folder is derived from the tool id, which is why the id is derived
      // from the key rather than typed.
      const toolId = `${app}.${key}`;
      // The raw JSON is stored, not the parse result, so key order is the author's.
      if (input.spec !== undefined) await validatedToolSpec(input.spec, { toolId, app });
      const specDraft = input.spec ?? null;

      // One locked read answers all three uniqueness questions. `for("update")`
      // also serializes two admins creating at once: the second read blocks on
      // the first transaction's locks and re-reads after it commits, so it sees
      // the new row and orders above it. `unique(app, sort_order)` from
      // migration 0005 stays the backstop, and it rolls the whole insert back.
      const siblings = await transaction
        .select({
          toolId: managedToolsTable.toolId,
          slug: managedToolsTable.slug,
          order: managedToolsTable.order,
        })
        .from(managedToolsTable)
        .where(eq(managedToolsTable.app, app))
        .for("update");

      if (siblings.some((tool) => tool.toolId === toolId)) {
        throw new Error(`Tool ${toolId} already exists.`);
      }
      if (siblings.some((tool) => tool.slug === slug)) {
        throw new Error("Tool slug is already in use.");
      }

      const order = siblings.reduce((highest, tool) => Math.max(highest, tool.order), -1) + 1;

      // Disabled: a tool with no code must not be publishable by accident.
      const [created] = await transaction
        .insert(managedToolsTable)
        .values({
          toolId,
          app,
          slug,
          name,
          description,
          order,
          enabled: false,
          archived: false,
          specDraft,
          translations: {
            en: {
              status: "published",
              messages: {
                name: escapeToolText(name),
                description: escapeToolText(description),
              },
            },
          },
        })
        .returning();

      // This row carries the category the admin chose; discarding it would mean
      // asking for a value and then throwing it away. Every other column stays
      // NULL, so it inherits from the stored spec once one is saved.
      //
      // Left unpublished (`publishedAt` NULL): until the code exists there is
      // nothing to publish, and `resolveContent` treats an unpublished row as
      // "use the code values".
      await transaction.insert(toolContentTable).values({ toolId, category });

      await writeAudit(transaction, actorUserId, "tool.create", "tool", toolId, {
        app,
        key,
        slug,
        category,
        order,
        hasSpecDraft: specDraft !== null,
      });
      return created;
    })
    .then((result) => invalidateAfterCommit(CACHE_NAMESPACES.CATALOG, result));
}

export async function updateManagedTool(actorUserId: string, toolId: string, input: ManagedToolEdit): Promise<ToolRow> {
  return db
    .transaction(async (transaction) => {
      await requireTransactionPermission(transaction, actorUserId, "tools", "edit");
      if (!isRecord(input)) throw new Error("Tool changes must be an object.");

      const current = await getToolForUpdate(transaction, toolId);
      const slug = Object.hasOwn(input, "slug") ? input.slug : current.slug;
      if (slug !== null && !isValidToolSlug(current.app, slug)) {
        throw new Error("Tool slug is invalid or reserved.");
      }
      assertToolSlugImmutable(current.slug, slug ?? null);

      const name = Object.hasOwn(input, "name") ? requiredText(input.name, "Tool name", 160) : current.name;
      const description = Object.hasOwn(input, "description")
        ? requiredText(input.description, "Tool description")
        : current.description;

      let translations = current.translations;
      if (translations?.en && (name !== current.name || description !== current.description)) {
        const spec = await specFromRow(current);
        const [content] = await transaction
          .select()
          .from(toolContentTable)
          .where(eq(toolContentTable.toolId, toolId))
          .limit(1)
          .for("update");
        translations = synchronizeEnglishSource(
          translations,
          toolTranslationSource(spec, current, content ?? null),
          toolTranslationSource(spec, { ...current, name, description }, content ?? null),
        );
      }

      if (slug !== null) {
        const [duplicate] = await transaction
          .select({ toolId: managedToolsTable.toolId })
          .from(managedToolsTable)
          .where(
            and(
              eq(managedToolsTable.app, current.app),
              eq(managedToolsTable.slug, slug),
              ne(managedToolsTable.toolId, toolId),
            ),
          )
          .limit(1);
        if (duplicate) throw new Error("Tool slug is already in use.");
      }

      const next = {
        toolId,
        app: current.app,
        slug: slug ?? null,
        name,
        description,
        order: current.order,
        enabled: current.enabled,
        archived: current.archived,
        ...(translations ? { translations } : {}),
      };
      const saved = await saveTool(transaction, next);
      await writeAudit(transaction, actorUserId, "tool.edit", "tool", toolId, {
        changes: Object.keys(input),
        slug: next.slug,
      });
      return saved;
    })
    .then((result) => invalidateAfterCommit(CACHE_NAMESPACES.CATALOG, result));
}

export async function reorderManagedTools(
  actorUserId: string,
  app: ToolApp,
  toolIds: readonly string[],
): Promise<void> {
  return db
    .transaction(async (transaction) => {
      await requireTransactionPermission(transaction, actorUserId, "tools", "edit");
      // The app's stored rows are the roster; a locked read means a concurrent
      // create cannot land between the count check and the writes.
      const stored = await transaction
        .select()
        .from(managedToolsTable)
        .where(eq(managedToolsTable.app, app))
        .for("update");
      const expectedIds = new Set(stored.map((tool) => tool.toolId));

      if (expectedIds.size === 0) throw new Error("Tool app is invalid.");
      if (
        !Array.isArray(toolIds) ||
        toolIds.length !== expectedIds.size ||
        new Set(toolIds).size !== toolIds.length ||
        toolIds.some((toolId) => typeof toolId !== "string" || !expectedIds.has(toolId))
      ) {
        throw new Error(`Tool order must contain every registered ${app} tool exactly once.`);
      }

      const orderById = new Map(toolIds.map((toolId, order) => [toolId, order]));

      for (const tool of stored) {
        await saveTool(transaction, {
          ...tool,
          order: orderById.get(tool.toolId)!,
        });
      }

      await writeAudit(transaction, actorUserId, "tool.reorder", "tool-list", app, {
        toolIds,
      });
    })
    .then((result) => invalidateAfterCommit(CACHE_NAMESPACES.CATALOG, result));
}

export async function setManagedToolEnabled(actorUserId: string, toolId: string, enabled: boolean): Promise<ToolRow> {
  return db
    .transaction(async (transaction) => {
      await requireTransactionPermission(transaction, actorUserId, "tools", "toggle");
      assertBoolean(enabled, "Tool enabled state");
      const current = await getToolForUpdate(transaction, toolId);
      if (enabled && current.slug === null) {
        throw new Error("A tool needs a slug before it can be enabled.");
      }
      if (enabled && current.archived) {
        throw new Error("An archived tool cannot be enabled.");
      }
      if (enabled) {
        const english = current.translations?.en;
        if (english?.status !== "published") {
          throw new Error("Publish English translations before enabling the tool.");
        }
        const spec = await specFromRow(current);
        const [content] = spec
          ? await transaction
              .select()
              .from(toolContentTable)
              .where(eq(toolContentTable.toolId, toolId))
              .limit(1)
              .for("update")
          : [];
        const issues = validateToolTranslation(
          "en",
          english.messages,
          toolTranslationSource(spec, current, content ?? null),
          { publish: true },
        );
        if (issues.length) throw new ToolTranslationValidationError(issues);
      }

      const saved = await saveTool(transaction, { ...current, enabled });
      await writeAudit(transaction, actorUserId, "tool.toggle", "tool", toolId, {
        enabled,
      });
      return saved;
    })
    .then((result) => invalidateAfterCommit(CACHE_NAMESPACES.CATALOG, result));
}

export async function setManagedToolArchived(actorUserId: string, toolId: string, archived: boolean): Promise<ToolRow> {
  return db
    .transaction(async (transaction) => {
      await requireTransactionPermission(transaction, actorUserId, "tools", "archive");
      assertBoolean(archived, "Tool archived state");
      const current = await getToolForUpdate(transaction, toolId);
      const saved = await saveTool(transaction, {
        ...current,
        archived,
        enabled: archived ? false : current.enabled,
      });
      await writeAudit(transaction, actorUserId, "tool.archive", "tool", toolId, {
        archived,
      });
      return saved;
    })
    .then((result) => invalidateAfterCommit(CACHE_NAMESPACES.CATALOG, result));
}

// ---------------------------------------------------------------------------
// Database-owned tool content.
//
// Every `tool_content` column is nullable and NULL means "fall back to the
// stored spec" — that is what keeps a tool working with no content row at all. So a blank string or an empty list CLEARS the
// override rather than storing an empty one, matching `resolveContent`, which
// treats blank text and empty arrays as "not set" on read.
//
// Rows are written through the transaction (not through the `db`
// helpers, which own their own connection) so the write and its audit event
// commit together, exactly like every other mutation in this file.
// ---------------------------------------------------------------------------

export const MAX_TOOL_ICON_BYTES = 1_048_576;

/**
 * Upload credentials live only on the server; this reports whether they exist
 * so the admin UI can disable uploads with a message instead of failing at the
 * end of a form submission. Local development and CI have no Cloudinary account.
 */
export async function iconUploadsConfigured(): Promise<boolean> {
  return (await cloudinaryCredentials()) !== null;
}

/** The shape `contentDoc` is validated against before it is stored. */
export type ToolContentDocEdit = {
  readonly howToUse: readonly string[];
  readonly limitations?: readonly string[];
  readonly faq?: readonly { readonly q: string; readonly a: string }[];
  readonly examples?: readonly {
    readonly label: string;
    readonly text: string;
    readonly secondary?: string;
    readonly settings?: Readonly<Record<string, unknown>>;
  }[];
  readonly relatedToolIds?: readonly string[];
};

export type ToolContentEdit = {
  readonly category: string | null;
  readonly keywords: readonly string[] | null;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  /** Untrusted jsonb: validated against {@link ToolContentDocEdit} on write. */
  readonly contentDoc: unknown;
};

export type ToolIconUpload = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
};

const CONTENT_FIELDS = ["category", "keywords", "seoTitle", "seoDescription", "contentDoc"] as const;

const CONTENT_DOC_KEYS = ["howToUse", "limitations", "faq", "examples", "relatedToolIds"] as const;

function boundedText(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

/**
 * Deliberately at least as strict as the schema `resolveContent` validates with
 * on read: a document this accepts must never be one the resolver silently
 * discards.
 */
const contentDocEditSchema = z.object({
  howToUse: z.array(boundedText(400)).min(1).max(20),
  limitations: z.array(boundedText(400)).max(20).optional(),
  faq: z
    .array(z.object({ q: boundedText(300), a: boundedText(2_000) }))
    .max(20)
    .optional(),
  examples: z
    .array(
      z.object({
        label: boundedText(120),
        text: boundedText(4_000),
        secondary: boundedText(4_000).optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(20)
    .optional(),
  relatedToolIds: z.array(boundedText(120)).max(12).optional(),
});

/** Blank is "inherit from code", never "override with empty". */
function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }
  return trimmed;
}

function optionalTextList(value: unknown, label: string, maxCount: number, maxLength: number): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  const cleaned = value.flatMap((entry) => {
    const text = optionalText(entry, label, maxLength);
    return text === null ? [] : [text];
  });
  if (cleaned.length > maxCount) {
    throw new Error(`${label} must have ${maxCount} entries or fewer.`);
  }
  return cleaned.length > 0 ? cleaned : null;
}

/** Validated on write, not only in the picker. */
function toolContentCategory(value: unknown): CategoryKey | null {
  const category = optionalText(value, "Tool category", 64);
  if (category === null) return null;
  if (!isCategoryKey(category)) {
    throw new Error("Tool category is not a registered category.");
  }
  return category;
}

function assertRelatedToolIds(ids: readonly string[], toolId: string, knownToolIds: ReadonlySet<string>): void {
  for (const relatedToolId of ids) {
    if (relatedToolId === toolId) {
      throw new Error("A tool cannot be related to itself.");
    }
    if (!knownToolIds.has(relatedToolId)) {
      throw new Error(`Related tools must be tool ids, not slugs: ${relatedToolId} is not registered.`);
    }
  }
}

/**
 * Why `value` could not be saved as this one content field, using the same
 * rules as {@link updateToolContent}; undefined when it can.
 */
export function toolContentFieldError(
  toolId: string,
  field: (typeof CONTENT_FIELDS)[number] | (typeof CONTENT_DOC_KEYS)[number],
  value: unknown,
  knownToolIds: ReadonlySet<string>,
): string | undefined {
  try {
    if (field === "contentDoc") return "Suggest the document fields one at a time.";
    if (field === "category") {
      if (toolContentCategory(value) === null) throw new Error("Choose a category.");
    } else if (field === "seoTitle" || field === "seoDescription") {
      const label = field === "seoTitle" ? "SEO title" : "SEO description";
      if (optionalText(value, label, field === "seoTitle" ? 160 : 320) === null) throw new Error(`${label} is empty.`);
    } else if (field === "keywords") {
      if (optionalTextList(value, "Tool keywords", 24, 60) === null) throw new Error("Suggest at least one keyword.");
    } else {
      const parsed = contentDocEditSchema.shape[field].safeParse(value);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid value.");
      if (field === "relatedToolIds") assertRelatedToolIds((parsed.data ?? []) as string[], toolId, knownToolIds);
    }
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid value.";
  }
}

function toolContentDoc(
  value: unknown,
  toolId: string,
  knownToolIds: ReadonlySet<string>,
): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) {
    throw new Error("Tool content document must be an object.");
  }

  const isEmpty = CONTENT_DOC_KEYS.every((key) => {
    const entry = value[key];
    return entry === null || entry === undefined || (Array.isArray(entry) && entry.length === 0);
  });
  if (isEmpty) return null;

  const parsed = contentDocEditSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Tool content document is invalid: ${parsed.error.issues[0]?.message ?? "unknown shape"}.`);
  }

  assertRelatedToolIds(parsed.data.relatedToolIds ?? [], toolId, knownToolIds);

  // Stamped with the version the resolver understands; an unversioned or stale
  // document falls back to the code content instead of going live.
  return { version: TOOL_CONTENT_DOC_VERSION, ...parsed.data };
}

export async function updateToolContent(actorUserId: string, toolId: string, input: ToolContentEdit): Promise<void> {
  return db
    .transaction(async (transaction) => {
      await requireTransactionPermission(transaction, actorUserId, "tools", "edit");
      if (!isRecord(input)) throw new Error("Tool content must be an object.");

      const current = await getToolForUpdate(transaction, toolId);
      // Related tools are validated against the stored roster, so a curated link
      // can only point at a tool that exists.
      const knownToolIds = new Set(
        (await transaction.select({ toolId: managedToolsTable.toolId }).from(managedToolsTable)).map(
          (row) => row.toolId,
        ),
      );
      const values = {
        category: toolContentCategory(input.category),
        keywords: optionalTextList(input.keywords, "Tool keywords", 24, 60),
        seoTitle: optionalText(input.seoTitle, "SEO title", 160),
        seoDescription: optionalText(input.seoDescription, "SEO description", 320),
        contentDoc: toolContentDoc(input.contentDoc, toolId, knownToolIds),
        docVersion: TOOL_CONTENT_DOC_VERSION,
        updatedAt: new Date(),
      };

      let previousContent: ToolContentRow | null = null;
      if (current.translations?.en) {
        const [previous] = await transaction
          .select()
          .from(toolContentTable)
          .where(eq(toolContentTable.toolId, toolId))
          .limit(1)
          .for("update");
        previousContent = previous ?? null;
      }

      // `tool_content.tool_id` references `managed_tools`, so the parent row has
      // to exist before the child row can.
      await saveTool(transaction, current);
      await transaction
        .insert(toolContentTable)
        .values({ toolId, ...values })
        .onConflictDoUpdate({ target: toolContentTable.toolId, set: values });
      if (current.translations?.en) {
        await syncContentEnglish(transaction, current, previousContent, {
          toolId,
          publishedAt: previousContent?.publishedAt ?? null,
          ...values,
        });
      }

      await writeAudit(transaction, actorUserId, "tool.content-edit", "tool", toolId, {
        overrides: CONTENT_FIELDS.filter((field) => values[field] !== null),
      });
    })
    .then((result) => invalidateAfterCommit(CACHE_NAMESPACES.CATALOG, result));
}

/**
 * `published_at` is what makes the stored row live: while it is NULL the code
 * values are served no matter what else the row holds.
 */
export async function setToolContentPublished(actorUserId: string, toolId: string, published: boolean): Promise<void> {
  return db
    .transaction(async (transaction) => {
      await requireTransactionPermission(transaction, actorUserId, "tools", "toggle");
      assertBoolean(published, "Tool content published state");
      const current = await getToolForUpdate(transaction, toolId);

      const [stored] = await transaction
        .select()
        .from(toolContentTable)
        .where(eq(toolContentTable.toolId, toolId))
        .limit(1)
        .for("update");
      if (!stored) throw new Error("Save tool content before publishing it.");

      await syncContentEnglish(transaction, current, stored, {
        ...stored,
        publishedAt: published ? new Date() : null,
      });

      await transaction
        .update(toolContentTable)
        .set({ publishedAt: published ? new Date() : null, updatedAt: new Date() })
        .where(eq(toolContentTable.toolId, toolId));

      await writeAudit(transaction, actorUserId, "tool.content-publish", "tool", toolId, {
        published,
      });
    })
    .then((result) => invalidateAfterCommit(CACHE_NAMESPACES.CATALOG, result));
}

/**
 * Size first, then SVG by MIME *and* by leading bytes — a renamed `.png` that
 * is really SVG markup is a stored-XSS vector, so the sniff is not optional.
 * `uploadToolIcon` repeats both checks and pins a raster `allowed_formats`;
 * this is the boundary copy, rejected before any database or network work.
 */
function assertUploadableIcon(bytes: unknown, mimeType: unknown): asserts bytes is Uint8Array {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("The icon must be uploaded as binary data.");
  }
  if (bytes.byteLength > MAX_TOOL_ICON_BYTES) {
    throw new Error("The icon must be 1 MB or smaller.");
  }
  if (bytes.byteLength === 0) throw new Error("The icon file is empty.");

  const normalizedMimeType =
    typeof mimeType === "string" ? (mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "") : "";
  const leadingBytes = new TextDecoder().decode(bytes.subarray(0, 512)).toLowerCase();
  if (normalizedMimeType === "image/svg+xml" || leadingBytes.includes("<svg") || leadingBytes.includes("<?xml")) {
    throw new Error("SVG icons are not supported.");
  }
}

export async function saveToolIcon(actorUserId: string, toolId: string, upload: ToolIconUpload): Promise<string> {
  if (!isRecord(upload)) throw new Error("Icon upload must be an object.");
  assertUploadableIcon(upload.bytes, upload.mimeType);
  const mimeType = String(upload.mimeType);

  await db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "tools", "edit");
    await getToolForUpdate(transaction, toolId);
  });

  // Signed, server-side upload. It runs between the two transactions on
  // purpose: a network round trip must not hold row locks open.
  const uploaded = await uploadToolIcon(toolId, upload.bytes, mimeType);
  if (!uploaded.ok) throw new Error(uploaded.reason);
  const { iconUrl, publicId, format } = uploaded;

  return db
    .transaction(async (transaction) => {
      await requireTransactionPermission(transaction, actorUserId, "tools", "edit");
      await getToolForUpdate(transaction, toolId);
      await transaction
        .update(managedToolsTable)
        .set({ iconUrl, updatedAt: new Date() })
        .where(eq(managedToolsTable.toolId, toolId));

      await writeAudit(transaction, actorUserId, "tool.icon-upload", "tool", toolId, {
        publicId,
        format,
      });
      return iconUrl;
    })
    .then((result) => invalidateAfterCommit(CACHE_NAMESPACES.CATALOG, result));
}

/** Clearing the URL falls the tool back to its generated identicon. */
export async function removeToolIcon(actorUserId: string, toolId: string): Promise<void> {
  return db
    .transaction(async (transaction) => {
      await requireTransactionPermission(transaction, actorUserId, "tools", "edit");
      await getToolForUpdate(transaction, toolId);
      await transaction
        .update(managedToolsTable)
        .set({ iconUrl: null, updatedAt: new Date() })
        .where(eq(managedToolsTable.toolId, toolId));
      await writeAudit(transaction, actorUserId, "tool.icon-remove", "tool", toolId, {});
    })
    .then((result) => invalidateAfterCommit(CACHE_NAMESPACES.CATALOG, result));
}

function getFeatureManifestEntry(
  manifest: readonly FeatureManifestEntry[],
  app: FeatureApp,
  key: string,
): FeatureManifestEntry {
  const entries = manifest.filter((entry) => entry.app === app && entry.key === key);
  if (entries.length !== 1) throw new Error(`Unknown feature: ${app}.${key}.`);
  return entries[0];
}

async function getFeatureForUpdate(transaction: Transaction, entry: FeatureManifestEntry) {
  const [stored] = await transaction
    .select()
    .from(featureOverridesTable)
    .where(and(eq(featureOverridesTable.app, entry.app), eq(featureOverridesTable.key, entry.key)))
    .limit(1)
    .for("update");
  return (
    stored ?? {
      app: entry.app,
      key: entry.key,
      name: entry.defaultName,
      description: entry.defaultDescription,
      enabled: false,
      updatedAt: new Date(),
    }
  );
}

async function saveFeature(transaction: Transaction, feature: typeof featureOverridesTable.$inferInsert) {
  const now = new Date();
  const [saved] = await transaction
    .insert(featureOverridesTable)
    .values({ ...feature, updatedAt: now })
    .onConflictDoUpdate({
      target: [featureOverridesTable.app, featureOverridesTable.key],
      set: {
        name: feature.name,
        description: feature.description,
        enabled: feature.enabled,
        updatedAt: now,
      },
    })
    .returning();
  return saved;
}

export async function updateFeature(
  actorUserId: string,
  app: FeatureApp,
  key: string,
  input: FeatureEdit,
  manifest: readonly FeatureManifestEntry[],
) {
  return db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "features", "edit");
    const entry = getFeatureManifestEntry(manifest, app, key);
    if (!isRecord(input)) throw new Error("Feature changes must be an object.");
    const current = await getFeatureForUpdate(transaction, entry);
    const saved = await saveFeature(transaction, {
      app,
      key,
      name: Object.hasOwn(input, "name") ? requiredText(input.name, "Feature name", 160) : current.name,
      description: Object.hasOwn(input, "description")
        ? requiredText(input.description, "Feature description")
        : current.description,
      enabled: current.enabled,
    });
    await writeAudit(transaction, actorUserId, "feature.edit", "feature", `${app}:${key}`, {
      changes: Object.keys(input),
    });
    return saved;
  });
}

export async function setFeatureEnabled(
  actorUserId: string,
  app: FeatureApp,
  key: string,
  enabled: boolean,
  manifest: readonly FeatureManifestEntry[],
) {
  return db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "features", "toggle");
    assertBoolean(enabled, "Feature enabled state");
    const entry = getFeatureManifestEntry(manifest, app, key);
    const current = await getFeatureForUpdate(transaction, entry);
    const saved = await saveFeature(transaction, { ...current, enabled });
    await writeAudit(transaction, actorUserId, "feature.toggle", "feature", `${app}:${key}`, {
      enabled,
    });
    return saved;
  });
}

async function getUserForUpdate(transaction: Transaction, userId: string): Promise<typeof authUser.$inferSelect> {
  const [user] = await transaction.select().from(authUser).where(eq(authUser.id, userId)).limit(1).for("update");
  if (!user) throw new Error("User not found.");
  return user;
}

async function getUserRoleIdsForUpdate(transaction: Transaction, userId: string): Promise<string[]> {
  const rows = await transaction
    .select({ roleId: userRolesTable.roleId })
    .from(userRolesTable)
    .where(eq(userRolesTable.userId, userId))
    .for("update");
  return rows.map(({ roleId }) => roleId);
}

async function getAdminCounts(transaction: Transaction) {
  const rows = await transaction
    .select({ userId: userRolesTable.userId, status: authUser.status })
    .from(userRolesTable)
    .innerJoin(authUser, eq(authUser.id, userRolesTable.userId))
    .where(eq(userRolesTable.roleId, "admin"))
    .for("update");
  const admins = new Map(rows.map((row) => [row.userId, row.status]));
  return {
    adminCount: admins.size,
    activeAdminCount: [...admins.values()].filter((status) => status === "active").length,
  };
}

function authorizationUser(user: typeof authUser.$inferSelect, roles: string[]): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    status: user.status,
    roles,
  };
}

export async function assignUserRoles(
  actorUserId: string,
  targetUserId: string,
  requestedRoleIds: readonly string[],
): Promise<string[]> {
  return withUserCacheInvalidation((invalidate) =>
    db.transaction(async (transaction) => {
      await requireTransactionPermission(transaction, actorUserId, "users", "assignRoles");
      if (!Array.isArray(requestedRoleIds)) {
        throw new Error("Role assignments must be an array.");
      }
      const nextRoleIds = [
        ...new Set(["user", ...requestedRoleIds.map((roleId) => requiredText(roleId, "Role id", 200))]),
      ];
      const target = await getUserForUpdate(transaction, targetUserId);
      const currentRoleIds = await getUserRoleIdsForUpdate(transaction, targetUserId);
      const existingRoles = await transaction
        .select({ id: rolesTable.id, access: rolesTable.access })
        .from(rolesTable)
        .where(inArray(rolesTable.id, nextRoleIds))
        .for("share");
      if (new Set(existingRoles.map(({ id }) => id)).size !== nextRoleIds.length) {
        throw new Error("One or more assigned roles do not exist.");
      }
      assertAccessPrerequisites(mergeRoleAccess(existingRoles));

      if (currentRoleIds.includes("admin") && !nextRoleIds.includes("admin")) {
        assertCanDemoteUser(authorizationUser(target, currentRoleIds), await getAdminCounts(transaction));
      }
      if (
        currentRoleIds.length === nextRoleIds.length &&
        currentRoleIds.every((roleId) => nextRoleIds.includes(roleId))
      ) {
        return nextRoleIds;
      }

      await invalidate([targetUserId]);
      const removedRoleIds = currentRoleIds.filter((roleId) => !nextRoleIds.includes(roleId));
      const addedRoleIds = nextRoleIds.filter((roleId) => !currentRoleIds.includes(roleId));
      if (removedRoleIds.length) {
        await transaction
          .delete(userRolesTable)
          .where(and(eq(userRolesTable.userId, targetUserId), inArray(userRolesTable.roleId, removedRoleIds)));
      }
      if (addedRoleIds.length) {
        await transaction
          .insert(userRolesTable)
          .values(addedRoleIds.map((roleId) => ({ userId: targetUserId, roleId })));
      }
      await writeAudit(transaction, actorUserId, "user.assign-roles", "user", targetUserId, {
        previousRoleIds: currentRoleIds,
        roleIds: nextRoleIds,
      });
      return nextRoleIds;
    }),
  );
}

/** Adds one custom role atomically; never replaces memberships or changes account status. */
export async function assignRoleToUsers(
  actorUserId: string,
  requestedRoleId: string,
  requestedUserIds: readonly string[],
): Promise<void> {
  const roleId = requiredText(requestedRoleId, "Role id", 200);
  if (!Array.isArray(requestedUserIds) || requestedUserIds.length === 0) {
    throw new Error("Select at least one user.");
  }
  if (requestedUserIds.length > 100) throw new Error("Assign up to 100 users at a time.");
  const userIds = [...new Set(requestedUserIds.map((id) => requiredText(id, "User id", 200)))].sort();
  await withUserCacheInvalidation((invalidate) =>
    db.transaction(async (transaction) => {
      await requireTransactionPermission(transaction, actorUserId, "roles", "view");
      await requireTransactionPermission(transaction, actorUserId, "users", "assignRoles");
      // Match the per-user assignment lock order and lock targets consistently across batches.
      for (const userId of userIds) await getUserForUpdate(transaction, userId);
      const [role] = await transaction.select().from(rolesTable).where(eq(rolesTable.id, roleId)).limit(1).for("share");
      if (!role || role.isSystem) throw new Error("Choose an existing custom role.");
      assertAccessPrerequisites(role.access);
      for (const userId of userIds) {
        const previousRoleIds = await getUserRoleIdsForUpdate(transaction, userId);
        if (previousRoleIds.includes(roleId)) continue;
        await invalidate([userId]);
        await transaction.insert(userRolesTable).values({ userId, roleId });
        await writeAudit(transaction, actorUserId, "user.assign-roles", "user", userId, {
          previousRoleIds,
          roleIds: [...previousRoleIds, roleId],
        });
      }
    }),
  );
}

export async function setUserStatus(
  actorUserId: string,
  targetUserId: string,
  status: "active" | "suspended",
): Promise<void> {
  return withUserCacheInvalidation((invalidate) =>
    db.transaction(async (transaction) => {
      await requireTransactionPermission(transaction, actorUserId, "users", "suspend");
      if (status !== "active" && status !== "suspended") {
        throw new Error("User status must be active or suspended.");
      }
      const target = await getUserForUpdate(transaction, targetUserId);
      const roleIds = await getUserRoleIdsForUpdate(transaction, targetUserId);
      if (status === "suspended" && target.status === "active" && roleIds.includes("admin")) {
        assertCanSuspendUser(authorizationUser(target, roleIds), await getAdminCounts(transaction));
      }

      await invalidate([targetUserId]);
      if (target.status !== status) {
        await transaction.update(authUser).set({ status, updatedAt: new Date() }).where(eq(authUser.id, targetUserId));
      }
      // Keep the session identity so suspended accounts reach the access screen,
      // rather than regaining anonymous product access when their session vanishes.
      if (target.status !== status || status === "suspended") {
        await writeAudit(
          transaction,
          actorUserId,
          status === "suspended" ? "user.suspend" : "user.reactivate",
          "user",
          targetUserId,
          { previousStatus: target.status, status },
        );
      }
    }),
  );
}

async function getRoleForUpdate(transaction: Transaction, roleId: string): Promise<RoleRow> {
  const [role] = await transaction.select().from(rolesTable).where(eq(rolesTable.id, roleId)).limit(1).for("update");
  if (!role) throw new Error("Role not found.");
  return role;
}

export async function createCustomRole(
  actorUserId: string,
  input: { name: string; description: string },
): Promise<RoleRow> {
  return db
    .transaction(async (transaction) => {
      await requireTransactionPermission(transaction, actorUserId, "roles", "create");
      if (!isRecord(input)) throw new Error("Role input must be an object.");
      const values = {
        id: crypto.randomUUID(),
        name: requiredText(input.name, "Role name", 160),
        description: requiredText(input.description, "Role description"),
        access: { admin: { enter: true } },
        isSystem: false,
      };
      const [role] = await transaction.insert(rolesTable).values(values).returning();
      await writeAudit(transaction, actorUserId, "role.create", "role", values.id, {
        name: values.name,
      });
      return role;
    })
    .then((result) => invalidateAfterCommit(CACHE_NAMESPACES.ROLES, result));
}

export async function updateCustomRole(actorUserId: string, roleId: string, input: CustomRoleEdit): Promise<RoleRow> {
  return withUserCacheInvalidation((invalidate) =>
    db
      .transaction(async (transaction) => {
        await requireTransactionPermission(transaction, actorUserId, "roles", "edit");
        if (!isRecord(input)) throw new Error("Role changes must be an object.");
        const current = await getRoleForUpdate(transaction, roleId);
        assertCanEditRole(current);
        const requestedAccess = Object.hasOwn(input, "access") ? input.access : current.access;
        assertValidAccess(requestedAccess);
        const access = { ...requestedAccess, admin: { enter: true } };
        assertAccessPrerequisites(access);

        const members = await transaction
          .select({ userId: userRolesTable.userId })
          .from(userRolesTable)
          .where(eq(userRolesTable.roleId, roleId));
        await invalidate(members.map(({ userId }) => userId));
        const changes = {
          name: Object.hasOwn(input, "name") ? requiredText(input.name, "Role name", 160) : current.name,
          description: Object.hasOwn(input, "description")
            ? requiredText(input.description, "Role description")
            : current.description,
          access,
          updatedAt: new Date(),
        };
        const [role] = await transaction.update(rolesTable).set(changes).where(eq(rolesTable.id, roleId)).returning();
        await writeAudit(transaction, actorUserId, "role.edit", "role", roleId, {
          changes: [...new Set([...Object.keys(input), ...(current.access.admin?.enter === true ? [] : ["access"])])],
        });
        return role;
      })
      .then((result) => invalidateAfterCommit(CACHE_NAMESPACES.ROLES, result)),
  );
}

export async function deleteCustomRole(actorUserId: string, roleId: string): Promise<void> {
  return db
    .transaction(async (transaction) => {
      await requireTransactionPermission(transaction, actorUserId, "roles", "delete");
      const role = await getRoleForUpdate(transaction, roleId);
      const assignments = await transaction
        .select({ userId: userRolesTable.userId })
        .from(userRolesTable)
        .where(eq(userRolesTable.roleId, roleId))
        .for("update");
      assertCanDeleteRole(role, assignments.length);

      await transaction.delete(rolesTable).where(eq(rolesTable.id, roleId));
      await writeAudit(transaction, actorUserId, "role.delete", "role", roleId, {
        name: role.name,
      });
    })
    .then((result) => invalidateAfterCommit(CACHE_NAMESPACES.ROLES, result));
}

function templateValidationError(input: unknown): DocumentTemplate {
  const result = DocumentTemplateSchema.safeParse(input);
  if (result.success) return result.data as DocumentTemplate;
  throw new Error(result.error.issues.map(({ message }) => message).join("; "));
}

async function renderAdvancedTemplateForPublication(template: AdvancedDocumentTemplate) {
  const config = normalizeAdvancedTemplateConfig(template.config, template.documentType);
  const validation = validateAdvancedTemplateForPublish(config, template.documentType);
  if (!validation.valid) {
    throw new Error(`Publication blocked: ${validation.errors.map((issue) => issue.message).join("; ")}`);
  }
  if (validation.warnings.length) {
    console.warn(
      "Advanced template publication warnings",
      template.id,
      validation.warnings.map((issue) => issue.message),
    );
  }

  const [{ generate }, schemas] = await Promise.all([import("@pdfme/generator"), import("@pdfme/schemas")]);
  await generate({
    template: config.template,
    inputs: [config.sampleData],
    plugins: {
      text: withPdfmeTextFormatting(schemas.text),
      multiVariableText: schemas.multiVariableText,
      list: schemas.list,
      image: schemas.image,
      signature: schemas.signature,
      svg: schemas.svg,
      line: schemas.line,
      rectangle: schemas.rectangle,
      ellipse: schemas.ellipse,
      table: schemas.table,
      dateTime: schemas.dateTime,
      date: schemas.date,
      time: schemas.time,
      select: schemas.select,
      radioGroup: schemas.radioGroup,
      checkbox: schemas.checkbox,
      circleMark: schemas.circleMark,
      ...schemas.barcodes,
    },
  });
}

function makeTemplateDraft(
  input: DocumentTemplateContent & Pick<DocumentTemplate, "documentType">,
  id = crypto.randomUUID(),
) {
  if (!isRecord(input)) throw new Error("Template input must be an object.");
  return templateValidationError({
    id,
    name: input.name,
    slug: input.slug,
    description: input.description,
    category: input.category,
    status: "draft",
    isDefault: false,
    version: 1,
    documentType: input.documentType,
    layoutFamily: input.layoutFamily,
    config: input.config,
  });
}

function storedTemplateInput(row: TemplateRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? "",
    category: row.category,
    status: row.status,
    isDefault: row.isDefault,
    version: row.version,
    documentType: row.documentType,
    layoutFamily: row.layoutFamily,
    config: row.config,
  };
}

function templateInsertValues(
  template: ReturnType<typeof templateValidationError>,
): typeof invoiceTemplatesTable.$inferInsert {
  return {
    id: template.id,
    name: template.name,
    slug: template.slug,
    description: template.description,
    category: template.category,
    status: template.status,
    isDefault: template.isDefault,
    version: template.version,
    documentType: template.documentType,
    layoutFamily: template.layoutFamily,
    config: template.config,
  };
}

async function assertTemplateSlugAvailable(transaction: Transaction, slug: string, exceptId?: string): Promise<void> {
  const where = exceptId
    ? and(eq(invoiceTemplatesTable.slug, slug), ne(invoiceTemplatesTable.id, exceptId))
    : eq(invoiceTemplatesTable.slug, slug);
  const [duplicate] = await transaction
    .select({ id: invoiceTemplatesTable.id })
    .from(invoiceTemplatesTable)
    .where(where)
    .limit(1);
  if (duplicate) throw new Error("Template slug is already in use.");
}

async function getTemplateForUpdate(transaction: Transaction, templateId: string): Promise<TemplateRow> {
  const [template] = await transaction
    .select()
    .from(invoiceTemplatesTable)
    .where(eq(invoiceTemplatesTable.id, templateId))
    .limit(1)
    .for("update");
  if (!template) throw new Error("Invoice template not found.");
  return template;
}

async function insertTemplateDraft(
  transaction: Transaction,
  actorUserId: string,
  input: DocumentTemplateContent & Pick<DocumentTemplate, "documentType">,
  auditAction: "template.create" | "template.duplicate" | "template.import",
) {
  const template = makeTemplateDraft(input);
  await assertTemplateSlugAvailable(transaction, template.slug);
  const [saved] = await transaction.insert(invoiceTemplatesTable).values(templateInsertValues(template)).returning();
  await writeAudit(transaction, actorUserId, auditAction, "template", template.id, {
    name: template.name,
    slug: template.slug,
  });
  return saved;
}

export async function createInvoiceTemplate(actorUserId: string, input: InvoiceTemplateContent): Promise<TemplateRow> {
  return db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "templates", "create");
    return insertTemplateDraft(transaction, actorUserId, { ...input, documentType: "invoice" }, "template.create");
  });
}

export async function createAdvancedDocumentTemplate(
  actorUserId: string,
  input: AdvancedDocumentTemplateDraft,
): Promise<TemplateRow> {
  return db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "templates", "create");
    if (!isRecord(input)) {
      throw new Error("Advanced template input must be an object.");
    }
    return insertTemplateDraft(
      transaction,
      actorUserId,
      {
        name: input.name,
        slug: input.slug,
        description: input.description,
        category: input.category,
        documentType: input.documentType,
        layoutFamily: "advanced",
        config: createAdvancedTemplateConfig(input.documentType, input.pageFormat),
      },
      "template.create",
    );
  });
}

export async function duplicateDocumentTemplate(
  actorUserId: string,
  sourceTemplateId: string,
  input: { name: string; slug: string },
): Promise<TemplateRow> {
  return db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "templates", "create");
    if (!isRecord(input)) throw new Error("Duplicate input must be an object.");
    const source = await getTemplateForUpdate(transaction, sourceTemplateId);
    const parsed = templateValidationError(storedTemplateInput(source));
    return insertTemplateDraft(
      transaction,
      actorUserId,
      {
        name: requiredText(input.name, "Template name", 160),
        slug: requiredText(input.slug, "Template slug", 160),
        description: parsed.description,
        category: parsed.category,
        documentType: parsed.documentType,
        layoutFamily: parsed.layoutFamily,
        config: parsed.config,
      },
      "template.duplicate",
    );
  });
}

export async function importDocumentTemplate(actorUserId: string, input: unknown): Promise<TemplateRow> {
  return db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "templates", "create");
    const imported = templateValidationError(input);
    return insertTemplateDraft(
      transaction,
      actorUserId,
      {
        name: imported.name,
        slug: imported.slug,
        description: imported.description,
        category: imported.category,
        documentType: imported.documentType,
        layoutFamily: imported.layoutFamily,
        config: imported.config,
      },
      "template.import",
    );
  });
}

export async function updateDocumentTemplate(
  actorUserId: string,
  templateId: string,
  input: Partial<DocumentTemplateContent>,
): Promise<TemplateRow> {
  return db.transaction((transaction) =>
    updateDocumentTemplateInTransaction(transaction, actorUserId, templateId, input),
  );
}

async function updateDocumentTemplateInTransaction(
  transaction: Transaction,
  actorUserId: string,
  templateId: string,
  input: Partial<DocumentTemplateContent>,
): Promise<TemplateRow> {
  await requireTransactionPermission(transaction, actorUserId, "templates", "edit");
  if (!isRecord(input)) throw new Error("Template changes must be an object.");
  const current = await getTemplateForUpdate(transaction, templateId);
  const previous = templateValidationError(storedTemplateInput(current));
  if (Object.hasOwn(input, "slug") && input.slug !== previous.slug) {
    throw new Error("Template slug cannot be changed.");
  }
  const next = templateValidationError({
    ...previous,
    name: Object.hasOwn(input, "name") ? input.name : previous.name,
    slug: previous.slug,
    description: Object.hasOwn(input, "description") ? input.description : previous.description,
    category: Object.hasOwn(input, "category") ? input.category : previous.category,
    layoutFamily: Object.hasOwn(input, "layoutFamily") ? input.layoutFamily : previous.layoutFamily,
    config: Object.hasOwn(input, "config") ? input.config : previous.config,
    id: templateId,
    status: current.status,
    isDefault: current.isDefault,
    version: current.version + 1,
  });
  await assertTemplateSlugAvailable(transaction, next.slug, templateId);
  const { id: _id, ...values } = templateInsertValues(next);
  const [saved] = await transaction
    .update(invoiceTemplatesTable)
    .set({
      ...values,
      updatedAt: new Date(),
    })
    .where(eq(invoiceTemplatesTable.id, templateId))
    .returning();
  await writeAudit(transaction, actorUserId, "template.edit", "template", templateId, {
    changes: Object.keys(input),
    slug: next.slug,
  });
  return saved;
}

async function prepareDocumentTemplatePublication(actorUserId: string, templateId: string): Promise<DocumentTemplate> {
  return db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "templates", "publish");
    const current = await getTemplateForUpdate(transaction, templateId);
    return templateValidationError(storedTemplateInput(current));
  });
}

export async function publishDocumentTemplate(actorUserId: string, templateId: string): Promise<TemplateRow> {
  const template = await prepareDocumentTemplatePublication(actorUserId, templateId);
  if (template.layoutFamily === "advanced") {
    await renderAdvancedTemplateForPublication(template);
  }
  return db.transaction((transaction) =>
    publishDocumentTemplateInTransaction(transaction, actorUserId, templateId, template.version),
  );
}

async function publishDocumentTemplateInTransaction(
  transaction: Transaction,
  actorUserId: string,
  templateId: string,
  expectedVersion: number,
): Promise<TemplateRow> {
  await requireTransactionPermission(transaction, actorUserId, "templates", "publish");
  const current = await getTemplateForUpdate(transaction, templateId);
  if (current.version !== expectedVersion) {
    throw new Error("The template changed while its publication preview was rendering. Review and publish again.");
  }
  const template = templateValidationError(storedTemplateInput(current));
  const defaults = await transaction
    .select({ id: invoiceTemplatesTable.id })
    .from(invoiceTemplatesTable)
    .where(
      and(
        eq(invoiceTemplatesTable.documentType, template.documentType),
        eq(invoiceTemplatesTable.status, "published"),
        eq(invoiceTemplatesTable.isDefault, true),
      ),
    )
    .for("update");
  const isDefault = current.isDefault || defaults.some(({ id }) => id === templateId) || defaults.length === 0;
  const [saved] = await transaction
    .update(invoiceTemplatesTable)
    .set({ status: "published", isDefault, updatedAt: new Date() })
    .where(eq(invoiceTemplatesTable.id, templateId))
    .returning();
  await writeAudit(transaction, actorUserId, "template.publish", "template", templateId, {
    isDefault,
  });
  return saved;
}

export async function updateAndPublishDocumentTemplate(
  actorUserId: string,
  templateId: string,
  input: Partial<DocumentTemplateContent>,
): Promise<TemplateRow> {
  const updated = await updateDocumentTemplate(actorUserId, templateId, input);
  const template = templateValidationError(storedTemplateInput({ ...updated, id: templateId }));
  if (template.layoutFamily === "advanced") {
    await renderAdvancedTemplateForPublication(template);
  }
  return db.transaction((transaction) =>
    publishDocumentTemplateInTransaction(transaction, actorUserId, templateId, updated.version),
  );
}

export async function archiveDocumentTemplate(actorUserId: string, templateId: string): Promise<TemplateRow> {
  return db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "templates", "archive");
    const current = await getTemplateForUpdate(transaction, templateId);
    if (current.status === "published" && current.isDefault) {
      throw new Error("Set another published default before archiving this template.");
    }
    const [saved] = await transaction
      .update(invoiceTemplatesTable)
      .set({ status: "archived", isDefault: false, updatedAt: new Date() })
      .where(eq(invoiceTemplatesTable.id, templateId))
      .returning();
    await writeAudit(transaction, actorUserId, "template.archive", "template", templateId);
    return saved;
  });
}

export async function setDefaultDocumentTemplate(actorUserId: string, templateId: string): Promise<TemplateRow> {
  return db.transaction(async (transaction) => {
    await requireTransactionPermission(transaction, actorUserId, "templates", "publish");
    const current = await getTemplateForUpdate(transaction, templateId);
    if (current.status !== "published") {
      throw new Error("Only a published template can be the default.");
    }
    await transaction
      .select({ id: invoiceTemplatesTable.id })
      .from(invoiceTemplatesTable)
      .where(
        and(eq(invoiceTemplatesTable.documentType, current.documentType), eq(invoiceTemplatesTable.isDefault, true)),
      )
      .for("update");
    await transaction
      .update(invoiceTemplatesTable)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(eq(invoiceTemplatesTable.documentType, current.documentType), eq(invoiceTemplatesTable.isDefault, true)),
      );
    const [saved] = await transaction
      .update(invoiceTemplatesTable)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(invoiceTemplatesTable.id, templateId))
      .returning();
    await writeAudit(transaction, actorUserId, "template.set-default", "template", templateId);
    return saved;
  });
}

// Standard-invoice callers are a public compatibility surface.
export const duplicateInvoiceTemplate = duplicateDocumentTemplate;
export const importInvoiceTemplate = importDocumentTemplate;
export const updateInvoiceTemplate = updateDocumentTemplate;
export const publishInvoiceTemplate = publishDocumentTemplate;
export const updateAndPublishInvoiceTemplate = updateAndPublishDocumentTemplate;
export const archiveInvoiceTemplate = archiveDocumentTemplate;
export const setDefaultInvoiceTemplate = setDefaultDocumentTemplate;
