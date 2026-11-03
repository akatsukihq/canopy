// Runs every registry version's starter against a Piston URL and expects "Hello, Ada!".
// Usage: node scripts/piston/verify-versions.mjs http://127.0.0.1:2000   (Node >= 22.18 for .ts imports)
import { CODE_LANGUAGES, getCodeLanguage } from "../../lib/code-execution/languages.ts";
import { buildExecuteBody } from "../../lib/code-execution/piston.ts";

const base = process.argv[2] ?? process.env.PISTON_URL;
const runtimes = await (await fetch(`${base}/api/v2/runtimes`)).json();
const have = new Set(runtimes.flatMap((r) => [r.language, ...r.aliases].map((name) => `${name}@${r.version}`)));
let failed = 0;
for (const [key, entry] of Object.entries(CODE_LANGUAGES)) {
  for (const { id } of entry.versions) {
    const lang = getCodeLanguage(key, id);
    if (!have.has(`${lang.language}@${lang.version}`)) {
      console.log(`MISSING ${key} ${id}`);
      failed++;
      continue;
    }
    const started = Date.now();
    const res = await (
      await fetch(`${base}/api/v2/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildExecuteBody(lang, { source: lang.starter, stdin: "Ada\n" })),
      })
    ).json();
    const ok = (res.run?.stdout ?? "").trim() === "Hello, Ada!";
    if (!ok) failed++;
    const detail = {
      message: res.message,
      compile: res.compile?.output?.slice(0, 600),
      run: res.run?.output?.slice(0, 600),
      status: res.run?.status,
    };
    console.log(
      `${ok ? "PASS" : "FAIL"} ${key} ${id} (${Date.now() - started} ms)${ok ? "" : ` ${JSON.stringify(detail)}`}`,
    );
  }
}
console.log(failed ? `${failed} FAILED` : "all versions passed");
process.exit(failed ? 1 : 0);
