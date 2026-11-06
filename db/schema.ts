import type { Access } from "../lib/authorization/index.ts";
import type { ToolTranslations } from "../lib/tool-framework/translations.ts";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  json,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

export const anonymousUsersTable = pgTable("users", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const keyValuePairTable = pgTable(
  "key_value_pairs",
  {
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.key] })],
);

export const vendorProfilesTable = pgTable(
  "vendor_profiles",
  {
    userId: text("user_id").notNull(),
    id: text("id").notNull(),
    legalName: text("legal_name").notNull(),
    businessName: text("business_name"),
    email: text("email"),
    phone: text("phone"),
    addressLine1: text("address_line1"),
    city: text("city"),
    state: text("state"),
    zipCode: text("zip_code"),
    entityType: text("entity_type").default("Unknown").notNull(),
    w9Status: text("w9_status").default("Not Requested").notNull(),
    notes: text("notes"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.id] })],
);

export const invoiceTemplatesTable = pgTable(
  "invoice_templates",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    status: text("status").$type<import("../lib/invoice-templates/templateTypes.ts").TemplateStatus>().notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    version: integer("version").default(1).notNull(),
    documentType: text("document_type")
      .$type<
        | "invoice"
        | "receipt"
        | "expense-report"
        | "mileage-log"
        | "quarterly-tax-estimator"
        | "w9-request"
        | "1099-nec-tracker"
      >()
      .default("invoice")
      .notNull(),
    layoutFamily: text("layout_family").notNull(),
    config: jsonb("config").notNull(),
    isPremium: boolean("is_premium").default(false).notNull(),
    requiredPlan: text("required_plan").default("free").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("invoice_templates_slug_unique").on(table.slug),
    check(
      "invoice_templates_document_type_check",
      sql`${table.documentType} IN ('invoice', 'receipt', 'expense-report', 'mileage-log', 'quarterly-tax-estimator', 'w9-request', '1099-nec-tracker')`,
    ),
    check(
      "invoice_templates_advanced_document_type_check",
      sql`${table.layoutFamily} = 'advanced' OR ${table.documentType} = 'invoice'`,
    ),
    check(
      "invoice_templates_default_published_check",
      sql`${table.isDefault} = false OR ${table.status} = 'published'`,
    ),
    uniqueIndex("invoice_templates_published_default_by_document_type_unique")
      .on(table.documentType)
      .where(sql`${table.isDefault} = true AND ${table.status} = 'published'`),
    index("invoice_templates_published_document_type_updated_idx")
      .on(table.documentType, table.updatedAt.desc())
      .where(sql`${table.status} = 'published'`),
  ],
);

export const authUser = pgTable(
  "auth_users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    status: text("status").$type<"active" | "suspended">().default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("auth_users_email_unique").on(table.email)],
);

export const userPreferencesTable = pgTable(
  "user_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.key] })],
);

export const authSession = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_unique").on(table.token),
    index("auth_sessions_user_idx").on(table.userId),
  ],
);

export const authAccount = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("auth_accounts_provider_account_unique").on(table.providerId, table.accountId),
    index("auth_accounts_user_idx").on(table.userId),
  ],
);

export const authVerification = pgTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("auth_verifications_identifier_idx").on(table.identifier)],
);

export const rolesTable = pgTable(
  "roles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    access: jsonb("access").$type<Access>().default({}).notNull(),
    isSystem: boolean("is_system").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("roles_name_unique").on(table.name)],
);

export const userRolesTable = pgTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => rolesTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);

export const managedToolsTable = pgTable(
  "managed_tools",
  {
    toolId: text("tool_id").primaryKey(),
    app: text("app").$type<"paperwork" | "devtools" | "media">().notNull(),
    slug: text("slug"),
    /** Uploaded icon as a `MediaRef` (lib/media); untrusted JSON, validated where it is loaded. */
    icon: jsonb("icon").$type<unknown>(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    order: integer("sort_order").default(0).notNull(),
    translations: jsonb("translations").$type<ToolTranslations>().default({}).notNull(),
    /** The tool definition; untrusted JSON, validated where it is loaded. */
    // json, not jsonb: jsonb reorders keys and settings.fields order is render order.
    spec: json("spec").$type<unknown>(),
    /** An unpublished edit of `spec`; published by copying it into `spec`. */
    specDraft: json("spec_draft").$type<unknown>(),
    enabled: boolean("enabled").default(false).notNull(),
    archived: boolean("archived").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("managed_tools_app_slug_unique").on(table.app, table.slug),
    unique("managed_tools_app_sort_order_unique").on(table.app, table.order),
    check("managed_tools_translations_object_check", sql`jsonb_typeof(${table.translations}) = 'object'`),
    check("managed_tools_spec_object_check", sql`${table.spec} IS NULL OR json_typeof(${table.spec}) = 'object'`),
    check(
      "managed_tools_spec_draft_object_check",
      sql`${table.specDraft} IS NULL OR json_typeof(${table.specDraft}) = 'object'`,
    ),
  ],
);

export const systemLimitsTable = pgTable("system_limits", {
  key: text("key").primaryKey(),
  value: bigint("value", { mode: "number" }).notNull(),
  unit: text("unit").$type<"bytes" | "chars" | "count" | "px">().notNull(),
  description: text("description").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const platformSettingsTable = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text("updated_by"),
});

export const toolContentTable = pgTable("tool_content", {
  toolId: text("tool_id")
    .primaryKey()
    .references(() => managedToolsTable.toolId, { onDelete: "cascade" }),
  category: text("category"),
  keywords: text("keywords").array(),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  contentDoc: jsonb("content_doc").$type<unknown>(),
  docVersion: integer("doc_version").default(1).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const featureOverridesTable = pgTable(
  "feature_overrides",
  {
    key: text("key").notNull(),
    app: text("app").$type<"paperwork" | "devtools">().notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    enabled: boolean("enabled").default(false).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.app, table.key] })],
);

export const auditEventsTable = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("audit_events_created_idx").on(table.createdAt)],
);

export const usersTable = anonymousUsersTable;

export const blogCategoriesTable = pgTable(
  "blog_categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdBy: text("created_by").references(() => authUser.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => authUser.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("blog_categories_slug_unique").on(table.slug),
    uniqueIndex("blog_categories_name_unique").on(sql`lower(${table.name})`),
    check("blog_categories_name_check", sql`length(trim(${table.name})) BETWEEN 1 AND 100`),
    check(
      "blog_categories_slug_check",
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(${table.slug}) <= 160`,
    ),
  ],
);

export const blogTagsTable = pgTable(
  "blog_tags",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdBy: text("created_by").references(() => authUser.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => authUser.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("blog_tags_slug_unique").on(table.slug),
    uniqueIndex("blog_tags_name_unique").on(sql`lower(${table.name})`),
    check("blog_tags_name_check", sql`length(trim(${table.name})) BETWEEN 1 AND 100`),
    check("blog_tags_slug_check", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(${table.slug}) <= 160`),
  ],
);

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const blogPostsTable = pgTable(
  "blog_posts",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    draftDocument: jsonb("draft_document").$type<unknown>().notNull(),
    draftHash: text("draft_hash").notNull(),
    version: integer("version").default(1).notNull(),
    revisionSequence: integer("revision_sequence").default(0).notNull(),
    draftUpdatedAt: timestamp("draft_updated_at", { withTimezone: true }).defaultNow().notNull(),
    draftUpdatedBy: text("draft_updated_by").references(() => authUser.id, {
      onDelete: "set null",
    }),
    lastCheckpointAt: timestamp("last_checkpoint_at", { withTimezone: true }),
    publishedRevisionId: text("published_revision_id"),
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    publishedUpdatedAt: timestamp("published_updated_at", { withTimezone: true }),
    publishedCategoryId: text("published_category_id").references(() => blogCategoriesTable.id),
    publishedSearch: tsvector("published_search"),
    createdBy: text("created_by").references(() => authUser.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
  },
  (table): PgTableExtraConfigValue[] => [
    uniqueIndex("blog_posts_slug_unique").on(table.slug),
    check("blog_posts_slug_check", sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(${table.slug}) <= 160`),
    check("blog_posts_document_check", sql`jsonb_typeof(${table.draftDocument}) = 'object'`),
    check("blog_posts_version_check", sql`${table.version} > 0 AND ${table.revisionSequence} >= 0`),
    check("blog_posts_trash_check", sql`${table.trashedAt} IS NULL OR ${table.publishedRevisionId} IS NULL`),
    check(
      "blog_posts_publication_check",
      sql`${table.publishedRevisionId} IS NULL OR (${table.publishedCategoryId} IS NOT NULL AND ${table.firstPublishedAt} IS NOT NULL AND ${table.publishedUpdatedAt} IS NOT NULL)`,
    ),
    foreignKey({
      name: "blog_posts_published_revision_fk",
      columns: [table.id, table.publishedRevisionId],
      foreignColumns: [blogRevisionsTable.postId, blogRevisionsTable.id],
    }),
    index("blog_posts_published_idx")
      .on(table.firstPublishedAt.desc(), table.id.desc())
      .where(sql`${table.publishedRevisionId} IS NOT NULL AND ${table.trashedAt} IS NULL`),
    index("blog_posts_category_published_idx")
      .on(table.publishedCategoryId, table.firstPublishedAt.desc(), table.id.desc())
      .where(sql`${table.publishedRevisionId} IS NOT NULL AND ${table.trashedAt} IS NULL`),
    index("blog_posts_search_idx")
      .using("gin", table.publishedSearch)
      .where(sql`${table.publishedRevisionId} IS NOT NULL AND ${table.trashedAt} IS NULL`),
    index("blog_posts_admin_idx")
      .on(table.updatedAt.desc(), table.id.desc())
      .where(sql`${table.trashedAt} IS NULL`),
    index("blog_posts_trash_idx")
      .on(table.trashedAt.desc(), table.id.desc())
      .where(sql`${table.trashedAt} IS NOT NULL`),
  ],
);

export const blogRevisionsTable = pgTable(
  "blog_revisions",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references((): AnyPgColumn => blogPostsTable.id),
    revisionNumber: integer("revision_number").notNull(),
    document: jsonb("document").$type<unknown>().notNull(),
    contentHash: text("content_hash").notNull(),
    reason: text("reason")
      .$type<"create" | "autosave" | "manual_save" | "publish" | "schedule" | "restore_backup" | "restore">()
      .notNull(),
    sourceRevisionId: text("source_revision_id"),
    createdBy: text("created_by").references(() => authUser.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    unique("blog_revisions_post_number_unique").on(table.postId, table.revisionNumber),
    unique("blog_revisions_post_id_unique").on(table.postId, table.id),
    check("blog_revisions_number_check", sql`${table.revisionNumber} > 0`),
    check("blog_revisions_document_check", sql`jsonb_typeof(${table.document}) = 'object'`),
    check(
      "blog_revisions_reason_check",
      sql`${table.reason} IN ('create', 'autosave', 'manual_save', 'publish', 'schedule', 'restore_backup', 'restore')`,
    ),
    foreignKey({
      name: "blog_revisions_source_revision_fk",
      columns: [table.postId, table.sourceRevisionId],
      foreignColumns: [table.postId, table.id],
    }),
  ],
);

export const blogPublishedPostTagsTable = pgTable(
  "blog_published_post_tags",
  {
    postId: text("post_id")
      .notNull()
      .references(() => blogPostsTable.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => blogTagsTable.id),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.tagId] }),
    index("blog_published_post_tags_tag_idx").on(table.tagId, table.postId),
  ],
);

export const blogPostSchedulesTable = pgTable(
  "blog_post_schedules",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => blogPostsTable.id),
    revisionId: text("revision_id").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    scheduledBy: text("scheduled_by").references(() => authUser.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
  },
  (table) => [
    unique("blog_post_schedules_post_unique").on(table.postId),
    foreignKey({
      name: "blog_post_schedules_revision_fk",
      columns: [table.postId, table.revisionId],
      foreignColumns: [blogRevisionsTable.postId, blogRevisionsTable.id],
    }),
    index("blog_post_schedules_due_idx").on(table.scheduledAt, table.id),
  ],
);

export const assistantThreadsTable = pgTable(
  "assistant_threads",
  {
    id: text("id").primaryKey(),
    integrationKey: text("integration_key").notNull(),
    resourceId: text("resource_id"),
    ownerId: text("owner_id")
      .notNull()
      .references(() => authUser.id),
    title: text("title").notNull(),
    type: text("type").$type<"chat" | "inline">().notNull().default("chat"),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("assistant_threads_type_check", sql`${table.type} IN ('chat','inline')`),
    unique("assistant_threads_scope_unique").on(table.id, table.ownerId, table.integrationKey),
    unique("assistant_threads_resource_scope_unique").on(
      table.id,
      table.resourceId,
      table.ownerId,
      table.integrationKey,
    ),
    unique("assistant_threads_owner_unique").on(table.id, table.ownerId),
    index("assistant_threads_owner_resource_activity_idx").on(
      table.ownerId,
      table.integrationKey,
      table.resourceId,
      table.updatedAt.desc(),
      table.id,
    ),
  ],
);

export const assistantRunsTable = pgTable(
  "assistant_runs",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id"),
    integrationKey: text("integration_key").notNull(),
    resourceId: text("resource_id"),
    ownerId: text("owner_id")
      .notNull()
      .references(() => authUser.id),
    clientRequestId: text("client_request_id").notNull(),
    operation: text("operation").notNull(),
    executionMode: text("execution_mode").$type<import("../lib/assistant/types.ts").AssistantExecutionMode>().notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    providerResponseId: text("provider_response_id"),
    status: text("status").$type<import("../lib/assistant/types.ts").AssistantRunStatus>().notNull(),
    request: jsonb("request").$type<import("../lib/assistant/types.ts").AssistantRunRequest>().notNull(),
    inputMessageId: text("input_message_id"),
    response: jsonb("response").$type<import("../lib/assistant/types.ts").AssistantResult>(),
    continuation: jsonb("continuation").$type<Record<string, unknown>>().notNull().default({}),
    usage: jsonb("usage").$type<unknown>(),
    errorMessage: text("error_message"),
    /** Server-only failure diagnostics (never sent to the browser). */
    errorDetails: jsonb("error_details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    unique("assistant_runs_request_unique").on(table.ownerId, table.integrationKey, table.clientRequestId),
    uniqueIndex("assistant_runs_provider_response_unique")
      .on(table.provider, table.providerResponseId)
      .where(sql`${table.providerResponseId} IS NOT NULL`),
    unique("assistant_runs_thread_unique").on(table.id, table.threadId),
    foreignKey({
      name: "assistant_runs_input_message_scope_fk",
      columns: [table.inputMessageId, table.threadId],
      foreignColumns: [assistantMessagesTable.id, assistantMessagesTable.threadId],
    }),
    foreignKey({
      name: "assistant_runs_thread_scope_fk",
      columns: [table.threadId, table.ownerId, table.integrationKey],
      foreignColumns: [assistantThreadsTable.id, assistantThreadsTable.ownerId, assistantThreadsTable.integrationKey],
    }),
    foreignKey({
      name: "assistant_runs_thread_resource_scope_fk",
      columns: [table.threadId, table.resourceId, table.ownerId, table.integrationKey],
      foreignColumns: [
        assistantThreadsTable.id,
        assistantThreadsTable.resourceId,
        assistantThreadsTable.ownerId,
        assistantThreadsTable.integrationKey,
      ],
    }),
    index("assistant_runs_thread_created_idx").on(table.threadId, table.createdAt, table.id),
    index("assistant_runs_resource_operation_idx").on(
      table.integrationKey,
      table.resourceId,
      table.operation,
      table.createdAt.desc(),
    ),
    index("assistant_runs_expiry_idx").on(table.expiresAt),
    check("assistant_runs_execution_mode_check", sql`${table.executionMode} IN ('conversational','standalone')`),
    check(
      "assistant_runs_status_check",
      sql`${table.status} IN ('queued','running','completed','failed','cancelled','unknown','awaiting-approval')`,
    ),
  ],
);

export const assistantMessagesTable = pgTable(
  "assistant_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => assistantThreadsTable.id),
    runId: text("run_id"),
    role: text("role").$type<"user" | "assistant">().notNull(),
    parts: jsonb("parts").$type<import("../lib/assistant/types.ts").AssistantMessagePart[]>().notNull().default([]),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table): PgTableExtraConfigValue[] => [
    unique("assistant_messages_thread_unique").on(table.id, table.threadId),
    uniqueIndex("assistant_messages_run_unique")
      .on(table.runId)
      .where(sql`${table.runId} IS NOT NULL`),
    foreignKey({
      name: "assistant_messages_run_scope_fk",
      columns: [table.runId, table.threadId],
      foreignColumns: [assistantRunsTable.id, assistantRunsTable.threadId],
    }),
    index("assistant_messages_thread_updated_idx").on(table.threadId, table.updatedAt),
    check(
      "assistant_messages_role_check",
      sql`${table.role} IN ('user','assistant') AND (${table.runId} IS NULL OR ${table.role} = 'assistant')`,
    ),
    check("assistant_messages_parts_check", sql`jsonb_typeof(${table.parts}) = 'array'`),
    check("assistant_messages_meta_check", sql`jsonb_typeof(${table.meta}) = 'object'`),
  ],
);

export const assistantAttachmentsTable = pgTable(
  "assistant_attachments",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    messageId: text("message_id"),
    runId: text("run_id"),
    ownerId: text("owner_id")
      .notNull()
      .references(() => authUser.id),
    type: text("type").notNull(),
    label: text("label").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<"processing" | "ready" | "failed" | "deleting">().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "assistant_attachments_run_scope_fk",
      columns: [table.runId, table.threadId],
      foreignColumns: [assistantRunsTable.id, assistantRunsTable.threadId],
    }),
    uniqueIndex("assistant_attachments_run_unique")
      .on(table.runId)
      .where(sql`${table.runId} IS NOT NULL`),
    foreignKey({
      name: "assistant_attachments_thread_owner_fk",
      columns: [table.threadId, table.ownerId],
      foreignColumns: [assistantThreadsTable.id, assistantThreadsTable.ownerId],
    }),
    foreignKey({
      name: "assistant_attachments_message_scope_fk",
      columns: [table.messageId, table.threadId],
      foreignColumns: [assistantMessagesTable.id, assistantMessagesTable.threadId],
    }),
    index("assistant_attachments_thread_idx").on(table.ownerId, table.threadId),
    index("assistant_attachments_message_idx").on(table.messageId),
    index("assistant_attachments_expiry_idx")
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} IS NOT NULL`),
    index("assistant_attachments_deleting_idx")
      .on(table.updatedAt)
      .where(sql`${table.status} = 'deleting'`),
    check("assistant_attachments_data_check", sql`jsonb_typeof(${table.data}) = 'object'`),
    check("assistant_attachments_status_check", sql`${table.status} IN ('processing','ready','failed','deleting')`),
  ],
);

export const aiSkillsTable = pgTable("ai_skills", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiMcpServersTable = pgTable(
  "ai_mcp_servers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    transport: text("transport").$type<"http" | "sse">().notNull().default("http"),
    /** Header name → encrypted value (lib/config/secrets StoredSecret). Never sent to the browser. */
    headers: jsonb("headers").$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    tools: jsonb("tools").$type<{ name: string; description: string }[]>().notNull().default([]),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("ai_mcp_servers_transport_check", sql`${table.transport} IN ('http','sse')`)],
);

export const aiAgentsTable = pgTable(
  "ai_agents",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    command: text("command"),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    persona: text("persona").notNull(),
    model: text("model"),
    effort: text("effort").notNull().default("medium"),
    sections: jsonb("sections").$type<string[]>().notNull().default([]),
    defaultFor: jsonb("default_for").$type<string[]>().notNull().default([]),
    outputSchema: jsonb("output_schema").$type<Record<string, unknown> | null>(),
    proposesDocument: boolean("proposes_document").notNull().default(false),
    requiresDocument: boolean("requires_document").notNull().default(false),
    webSearch: boolean("web_search").notNull().default(false),
    builtinTools: jsonb("builtin_tools").$type<string[]>().notNull().default([]),
    skillIds: jsonb("skill_ids").$type<string[]>().notNull().default([]),
    mcpTools: jsonb("mcp_tools").$type<{ serverId: string; tool: string }[]>().notNull().default([]),
    subagents: jsonb("subagents")
      .$type<{ mode: "none" | "delegate" | "pipeline"; agentIds: string[] }>()
      .notNull()
      .default({ mode: "none", agentIds: [] }),
    enabled: boolean("enabled").notNull().default(true),
    version: integer("version").notNull().default(1),
    updatedBy: text("updated_by").references(() => authUser.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ai_agents_effort_check", sql`${table.effort} IN ('low','medium','high','xhigh','max')`),
    check(
      "ai_agents_output_schema_check",
      sql`${table.outputSchema} IS NULL OR jsonb_typeof(${table.outputSchema}) = 'object'`,
    ),
  ],
);

export const aiToolConnectionsTable = pgTable("ai_tool_connections", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** Template: fixed https origin (+ prefix) or one leading {{inputs.<id>}}. */
  baseUrl: text("base_url").notNull(),
  /** ToolInputField[] shared by every tool of the connection. */
  inputs: jsonb("inputs").$type<unknown[]>().notNull().default([]),
  headers: jsonb("headers").$type<Record<string, string>>().notNull().default({}),
  /** Field id → encrypted StoredSecret shared by every agent; an agent's own value overrides it. */
  secretValues: jsonb("secret_values").$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  updatedBy: text("updated_by").references(() => authUser.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiToolsTable = pgTable(
  "ai_tools",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    kind: text("kind").$type<"http" | "code">().notNull(),
    argsSchema: jsonb("args_schema").$type<Record<string, unknown>>().notNull(),
    /** ToolInputField[] (lib/agents/toolTypes.ts). */
    inputs: jsonb("inputs").$type<unknown[]>().notNull().default([]),
    /** Field id → encrypted StoredSecret shared by every agent; an agent's own value overrides it. */
    secretValues: jsonb("secret_values").$type<Record<string, unknown>>().notNull().default({}),
    http: jsonb("http").$type<Record<string, unknown> | null>(),
    code: jsonb("code").$type<Record<string, unknown> | null>(),
    output: jsonb("output").$type<Record<string, unknown>>().notNull(),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    /** Set for an endpoint of a connection: http kind, no own inputs, url is a path. */
    connectionId: text("connection_id").references(() => aiToolConnectionsTable.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by").references(() => authUser.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ai_tools_connection_id_idx").on(table.connectionId),
    check("ai_tools_kind_check", sql`${table.kind} IN ('http','code')`),
    check("ai_tools_args_schema_check", sql`jsonb_typeof(${table.argsSchema}) = 'object'`),
    check(
      "ai_tools_config_check",
      sql`(${table.kind} = 'http' AND ${table.http} IS NOT NULL AND ${table.code} IS NULL) OR (${table.kind} = 'code' AND ${table.code} IS NOT NULL AND ${table.http} IS NULL)`,
    ),
  ],
);

export const aiAgentToolsTable = pgTable(
  "ai_agent_tools",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => aiAgentsTable.id, { onDelete: "cascade" }),
    toolId: text("tool_id")
      .notNull()
      .references(() => aiToolsTable.id, { onDelete: "restrict" }),
    /** Field id → value; secret fields hold an encrypted StoredSecret (lib/config/secrets). Never sent to the browser. */
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.toolId] }),
    index("ai_agent_tools_tool_id_idx").on(table.toolId),
    check("ai_agent_tools_inputs_check", sql`jsonb_typeof(${table.inputs}) = 'object'`),
  ],
);

/** One agent's values for a connection's inputs, shared by every endpoint of it the agent enables. */
export const aiAgentConnectionsTable = pgTable(
  "ai_agent_connections",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => aiAgentsTable.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => aiToolConnectionsTable.id, { onDelete: "restrict" }),
    /** Field id → value; secrets hold an encrypted StoredSecret. Never sent to the browser. */
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.connectionId] }),
    index("ai_agent_connections_connection_id_idx").on(table.connectionId),
    check("ai_agent_connections_inputs_check", sql`jsonb_typeof(${table.inputs}) = 'object'`),
  ],
);
