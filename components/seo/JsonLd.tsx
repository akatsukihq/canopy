import { serializeJsonLd } from "@/lib/seo/structuredData";

/** Server-rendered schema.org JSON-LD, escaped for safe embedding. */
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
