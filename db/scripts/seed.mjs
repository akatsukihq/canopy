import config from "../../lib/config/config.ts";
import { seedTemplates } from "../../lib/invoice-templates/index.ts";
import { config as loadEnv } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../schema.ts";

// Shell variables win over local files, matching the migration command.
for (const file of [".env.local", ".env"]) {
  loadEnv({ path: new URL(`../../${file}`, import.meta.url), override: false });
}
const databaseUrl = config.databaseUrl;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 30_000 });
const db = drizzle(client, { schema });

try {
  await client.connect();
  const {
    rows: [{ template_count }],
  } = await client.query("SELECT COUNT(*)::integer AS template_count FROM invoice_templates");

  if (template_count === 0) {
    await db.transaction(async (transaction) => {
      for (const template of seedTemplates) {
        await transaction.execute(sql`
          INSERT INTO invoice_templates (
            id, name, slug, description, category, status, is_default,
            version, document_type, layout_family, config, is_premium,
            required_plan, created_at, updated_at
          ) VALUES (
            ${template.id}, ${template.name}, ${template.slug},
            ${template.description}, ${template.category}, ${template.status},
            ${template.isDefault}, ${template.version}, ${template.documentType},
            ${template.layoutFamily}, ${JSON.stringify(template.config)}::jsonb,
            ${template.isPremium ?? false}, ${template.requiredPlan ?? "free"},
            ${new Date(template.createdAt).toISOString()}, ${new Date(template.updatedAt).toISOString()}
          )
        `);
      }
    });
    console.log(`Seeded ${seedTemplates.length} invoice templates`);
  }
} finally {
  await client.end();
}
