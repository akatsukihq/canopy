/**
 * `/llms.txt` (llmstxt.org): a plain Markdown map of the site for AI agents.
 * Google Search ignores it; it costs little and helps agents that do read it.
 */

const SUITES = [
  {
    app: "paperwork",
    name: "Paperwork",
    path: "/paperwork",
    summary: "invoices, receipts, expense reports, mileage logs, tax estimates, and contractor records",
  },
  {
    app: "devtools",
    name: "Developer tools",
    path: "/devtools",
    summary: "JSON, CSV, Base64, regex, hashing, encoding, and code utilities",
  },
  {
    app: "media",
    name: "Media",
    path: "/media",
    summary: "compress, convert, merge, split, crop, and resize PDFs and images in the browser",
  },
] as const;

type LlmsTool = { app: string; name: string; description: string; href: string };

/** One line of plain text that cannot open a heading, list item, or link. */
function inline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function linkText(value: string): string {
  return inline(value).replace(/[[\]\\]/g, "\\$&");
}

export function buildLlmsTxt(tools: readonly LlmsTool[], appUrl: string): string {
  const url = (path: string) => new URL(path, appUrl).href;
  const lines = [
    "# SmartTools",
    "",
    "> Free online PDF, image, and developer tools that run in your browser. Create invoices, compress PDFs and images, format JSON, and more, with no sign-up.",
    "",
    "SmartTools (smarttools.lol) is a collection of focused, single-task web tools. Public tools work without an account. Media tools process files in the browser, so files are not uploaded. Pages are available in English, Hindi, Spanish, French, German, Brazilian Portuguese, Arabic, Simplified Chinese, Japanese, and Russian.",
    "",
    "## Suites",
    "",
    ...SUITES.map((suite) => `- [${suite.name}](${url(suite.path)}): ${suite.summary}`),
  ];

  for (const suite of SUITES) {
    const members = tools.filter((tool) => tool.app === suite.app);
    if (!members.length) continue;
    lines.push("", `## ${suite.name}`, "");
    for (const tool of members) {
      lines.push(`- [${linkText(tool.name)}](${url(tool.href)}): ${inline(tool.description)}`);
    }
  }

  lines.push(
    "",
    "## Optional",
    "",
    `- [Blog](${url("/blog")}): practical guides for documents, data, and everyday work`,
    `- [Blog RSS feed](${url("/blog/feed.xml")})`,
    `- [Privacy](${url("/privacy")})`,
    `- [Contact](${url("/contact")})`,
    `- [Sitemap](${url("/sitemap.xml")})`,
    "",
  );
  return lines.join("\n");
}
