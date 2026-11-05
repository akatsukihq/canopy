import { and, db, isDatabaseConfigured, managedToolsTable, sql } from "@/db/index.ts";
import { mediaRef } from "@/lib/media/index.ts";
import { toolIconUrl } from "@/lib/tool-framework/icons";

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (
    !Array.isArray(path) ||
    path.length < 3 ||
    path.length > 16 ||
    path.some(
      (segment) =>
        typeof segment !== "string" || !/^[\p{L}\p{N} _+.-]+$/u.test(segment) || segment === "." || segment === "..",
    ) ||
    path.join("/").length > 1024 ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(path[0]) ||
    !/^v[1-9]\d{0,15}$/.test(path[1]) ||
    !path.at(-1)!.endsWith(".png") ||
    path.at(-1)!.length <= 4
  ) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const [cloudName, version, ...rest] = path;
  const publicId = rest.join("/").slice(0, -4);
  if (!isDatabaseConfigured()) return notFound();
  // Only icons a tool actually stores, so this never proxies arbitrary Cloudinary assets.
  const [row] = await db
    .select({ icon: managedToolsTable.icon })
    .from(managedToolsTable)
    .where(
      and(
        sql`${managedToolsTable.icon}->'entry'->>'cloudName' = ${cloudName}`,
        sql`${managedToolsTable.icon}->'entry'->>'publicId' = ${publicId}`,
        sql`${managedToolsTable.icon}->'entry'->>'version' = ${version.slice(1)}`,
      ),
    )
    .limit(1);
  const icon = mediaRef.safeParse(row?.icon);
  if (!icon.success) return notFound();

  try {
    const response = await fetch(
      toolIconUrl(icon.data),
      {
        headers: { Accept: "image/png" },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok || !response.body || response.headers.get("content-type")?.split(";")[0].trim() !== "image/png") {
      await response.body?.cancel();
      return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    return new Response(response.body, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
