import type { Completion, CompletionSource } from "@codemirror/autocomplete";
import { linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView } from "@codemirror/view";

import {
  ideExtensions,
  renderInfo,
  type HoverInfo,
  type IntelligenceProvider,
  type SignatureInfo,
} from "./codeIntelligence";

type TsCommand =
  | { type: "init"; javascript: boolean }
  | { type: "update"; code: string }
  | { type: "complete" | "hover" | "definition" | "signature"; pos: number }
  | { type: "completionDetails"; pos: number; name: string; source?: string }
  | { type: "diagnostics" };
export type TsRequest = TsCommand & { id: number };
export type TsResponse = { id: number; result?: unknown; error?: string };

type TsCompletion = { label: string; type: string; sortText: string; insertText?: string; source?: string };

class TsClient {
  private readonly worker = new Worker(new URL("./tsLanguageService.worker.ts", import.meta.url), { type: "module" });
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private nextId = 0;

  constructor(javascript: boolean, code: string) {
    this.worker.onmessage = ({ data }: MessageEvent<TsResponse>) => {
      const waiter = this.pending.get(data.id);
      this.pending.delete(data.id);
      if (data.error) waiter?.reject(new Error(data.error));
      else waiter?.resolve(data.result);
    };
    // Optional feature: a failed load leaves plain editing and highlighting untouched.
    this.request({ type: "init", javascript }).catch(() => this.destroy());
    this.update(code);
  }

  request<T>(command: TsCommand): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ ...command, id } satisfies TsRequest);
    });
  }

  update(code: string) {
    this.request({ type: "update", code }).catch(() => {});
  }

  destroy() {
    this.worker.terminate();
    for (const waiter of this.pending.values()) waiter.reject(new Error("TypeScript worker stopped"));
    this.pending.clear();
  }
}

const clientPlugin = (javascript: boolean) =>
  ViewPlugin.define((view) => {
    const client = new TsClient(javascript, view.state.doc.toString());
    return {
      client,
      update(update) {
        if (update.docChanged) client.update(update.state.doc.toString());
      },
      destroy: () => client.destroy(),
    };
  });

function quiet<T>(promise: Promise<T>): Promise<T | null> {
  return promise.catch(() => null);
}

/** Full TypeScript language service (types, JSDoc, diagnostics) for JS and TS editors. */
export function tsIntelligence(javascript: boolean): { extension: Extension; completion: CompletionSource } {
  const plugin = clientPlugin(javascript);
  const clientOf = (view: EditorView | undefined) => (view ? view.plugin(plugin)?.client : undefined);

  const provider = (view: EditorView): IntelligenceProvider => ({
    hover: (_view, pos) =>
      quiet(clientOf(view)?.request<HoverInfo | null>({ type: "hover", pos }) ?? Promise.resolve(null)),
    definition: (_view, pos) =>
      quiet(clientOf(view)?.request<number | null>({ type: "definition", pos }) ?? Promise.resolve(null)),
    signature: (_view, pos) =>
      quiet(clientOf(view)?.request<SignatureInfo | null>({ type: "signature", pos }) ?? Promise.resolve(null)),
  });

  const completion: CompletionSource = async (context) => {
    const client = clientOf(context.view);
    const word = context.matchBefore(/[\w$]*/);
    if (!client || !word) return null;
    const member = /[.?]$/.test(context.state.sliceDoc(Math.max(0, word.from - 1), word.from));
    if (word.from === word.to && !member && !context.explicit) return null;
    const entries = await quiet(client.request<TsCompletion[] | undefined>({ type: "complete", pos: context.pos }));
    if (!entries || context.aborted) return null;
    const options: Completion[] = entries.map((entry) => ({
      label: entry.label,
      type: entry.type,
      apply: entry.insertText,
      // TypeScript ranks locals ("11") above globals ("15") and auto-imports; keep that order.
      boost: -Math.min(99, Number.parseInt(entry.sortText, 10) || 0),
      info: async () => {
        const details = await quiet(
          client.request<{ signature: string; docs: string } | null>({
            type: "completionDetails",
            pos: context.pos,
            name: entry.label,
            source: entry.source,
          }),
        );
        return details && context.view ? renderInfo(context.view.state, details.signature, details.docs) : null;
      },
    }));
    return { from: word.from, options, validFor: /^[\w$]*$/ };
  };

  const diagnostics = linter(
    async (view) => {
      const result = await quiet(clientOf(view)?.request<Diagnostic[]>({ type: "diagnostics" }) ?? Promise.resolve([]));
      const length = view.state.doc.length;
      return (result ?? []).filter((diagnostic) => diagnostic.to <= length);
    },
    { delay: 500 },
  );

  return { extension: [plugin, ideExtensions(provider), diagnostics], completion };
}
