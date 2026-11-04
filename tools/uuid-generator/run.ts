import { v1, v3, v4, v5, v6, v7, validate } from "uuid";
import type { ToolRun } from "../../lib/tool-framework/run.ts";
import { ToolError } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { getCrypto } from "../../lib/devtools/shared/crypto.ts";

type Settings = {
  readonly version: string;
  readonly namespace: string;
  readonly customNamespace: string;
  readonly name: string;
  readonly count: number;
  readonly hyphens: boolean;
  readonly upper: boolean;
};

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  ctx.signal.throwIfAborted();
  const { version, count, hyphens, upper } = ctx.settings;
  let values: string[];
  if (version === "v3" || version === "v5") {
    const { name, namespace, customNamespace } = ctx.settings;
    if (!name) {
      throw new ToolError(
        "missing-name",
        "Enter a name to generate this UUID.",
        "Enter a name and choose its namespace.",
        { messageRef: { key: "errors.missing-name" }, recoveryMessage: { key: "recovery.missing-name" } },
      );
    }
    const namespaceId = (namespace === "custom" ? customNamespace : namespace).trim();
    if (!validate(namespaceId)) {
      throw new ToolError(
        "invalid-namespace",
        "Enter a valid namespace UUID.",
        "Choose a preset namespace or enter a complete UUID with hyphens.",
        { messageRef: { key: "errors.invalid-namespace" }, recoveryMessage: { key: "recovery.invalid-namespace" } },
      );
    }
    values = [version === "v3" ? v3(name, namespaceId) : v5(name, namespaceId)];
  } else {
    const generate =
      version === "v1"
        ? () => v1()
        : version === "v4"
          ? () => v4()
          : version === "v6"
            ? () => v6()
            : version === "v7"
              ? () => v7()
              : null;
    if (!generate) {
      throw new ToolError("unsupported-version", "Choose a supported UUID version.", undefined, {
        messageRef: { key: "errors.unsupported-version" },
      });
    }
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      throw new ToolError(
        "invalid-count",
        "Enter a whole number from 1 to 100 for how many UUIDs to generate.",
        undefined,
        { messageRef: { key: "errors.invalid-count" } },
      );
    }
    getCrypto();
    values = Array.from({ length: count }, () => {
      ctx.signal.throwIfAborted();
      return generate();
    });
  }
  ctx.signal.throwIfAborted();
  const items = values.map((value) => {
    const formatted = hyphens ? value : value.replaceAll("-", "");
    return upper ? formatted.toUpperCase() : formatted;
  });
  return { render: "list", items, downloadName: "uuids.txt" };
};

export default run;
