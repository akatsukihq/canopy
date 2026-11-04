#!/usr/bin/env node
import { parseArgs } from "node:util";

import { findRepoRoot } from "../src/repo.mjs";
import { newTool } from "../src/tool/new.mjs";

const USAGE = `Usage: canopy <group> <command> [options]

  canopy tool new <key> --category <category> [--app devtools|media] [--runtime client|worker|server]
      Create tools/<key>/ and a disabled row with a starter spec in the local database.`;

const COMMANDS = {
  tool: {
    new: {
      options: {
        app: { type: "string", default: "devtools" },
        category: { type: "string" },
        runtime: { type: "string", default: "client" },
      },
      async run(root, values, [key]) {
        const created = await newTool(root, { key, ...values });
        console.log(`Created ${created.files.join(", ")} and a disabled ${created.toolId} row in the local database.`);
        console.log(
          "Next: open local Admin → Tools → this tool → Definition, save and publish the spec, publish English, then enable.",
        );
      },
    },
  },
};

async function main() {
  const [group, name, ...rest] = process.argv.slice(2);
  const command = COMMANDS[group]?.[name];
  if (!command) {
    console.log(USAGE);
    if (group && group !== "--help" && group !== "-h") process.exitCode = 1;
    return;
  }
  const { values, positionals } = parseArgs({ args: rest, options: command.options, allowPositionals: true });
  await command.run(findRepoRoot(), values, positionals);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
