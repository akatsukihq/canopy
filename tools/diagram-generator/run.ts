/**
 * Moved verbatim from the `diagram-generator` case in
 * `lib/devtools/format-json.ts`: the same 200,000-character cap, the same
 * `typeof document` guard, the same `securityLevel: "strict"` initialisation,
 * the same random render id, and the same `diagram.svg` download name.
 *
 * `run.ts`, not `run.server.ts`: Mermaid lays diagrams out by measuring text in
 * a real DOM, so this has always been and remains a browser-only render. The
 * import stays dynamic so Mermaid stays out of the initial bundle.
 */

import { getCrypto } from "../../lib/devtools/shared/crypto.ts";
import { bytesToHex } from "../../lib/devtools/shared/encoding.ts";
import { requireUtilityInput } from "../../lib/devtools/shared/options.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";

type Settings = {};

const MAX_SOURCE_CHARS = 200_000;

export const run: ToolRun<Settings> = async (ctx): Promise<ToolResult> => {
  const source = requireUtilityInput(ctx.input.text, "Mermaid diagram code");
  if (source.length > MAX_SOURCE_CHARS) {
    throw new ToolError(
      "diagram-too-large",
      "Mermaid diagram code is too large.",
      "Split the diagram into smaller ones — anything this size is unreadable anyway.",
      {
        messageRef: { key: "execution.errors.diagram-too-large" },
        recoveryMessage: { key: "execution.recovery.diagram-too-large" },
      },
    );
  }
  if (typeof document === "undefined") {
    throw new ToolError(
      "dom-required",
      "Mermaid diagram rendering requires a browser.",
      "Open this tool in a browser tab; Mermaid measures rendered text to lay out the diagram.",
      {
        messageRef: { key: "execution.errors.dom-required" },
        recoveryMessage: { key: "execution.recovery.dom-required" },
      },
    );
  }

  const { default: mermaid } = await import("mermaid");
  ctx.signal.throwIfAborted();
  mermaid.initialize({ securityLevel: "strict", startOnLoad: false, suppressErrorRendering: true });

  const id = `canopy-diagram-${bytesToHex(getCrypto().getRandomValues(new Uint8Array(8)))}`;
  let svg: string;
  try {
    ({ svg } = await mermaid.render(id, source));
  } catch (error) {
    throw new ToolError(
      "diagram-invalid",
      `Mermaid diagram is invalid: ${error instanceof Error ? error.message : "render failed"}`,
      "Check the first line declares a diagram type, and quote labels that contain brackets or punctuation.",
      {
        messageRef:
          error instanceof Error
            ? { key: "execution.errors.diagram-invalid", values: { diagnostic: error.message } }
            : { key: "execution.errors.render-failed" },
        recoveryMessage: { key: "execution.recovery.diagram-invalid" },
      },
    );
  }
  ctx.signal.throwIfAborted();

  return { render: "html", html: svg, downloadName: "diagram.svg" };
};

export default run;
