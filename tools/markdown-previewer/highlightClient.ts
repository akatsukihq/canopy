import type { SettingsSpec } from "../../lib/tool-framework/settings.ts";

type PendingRequest = { resolve: (html: string) => void; reject: (error: Error) => void };

/** One lazy worker per displayed document; cancellation discards every queued enhancement. */
export function createMarkdownHighlightClient(settingsSpec: SettingsSpec) {
  let worker: Worker | undefined;
  let nextId = 0;
  const pending = new Map<number, PendingRequest>();

  function stop(error: Error) {
    worker?.terminate();
    worker = undefined;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }

  function request(
    message:
      | { operation: "highlight"; code: string; language?: string }
      | {
          operation: "export";
          source: string;
          settings: Readonly<Record<string, unknown>>;
          settingsSpec: SettingsSpec;
        },
  ): Promise<string> {
    if (!worker) {
      try {
        const currentWorker = new Worker(new URL("./highlight.worker.ts", import.meta.url), {
          name: "markdown-highlighting",
        });
        worker = currentWorker;
        currentWorker.onmessage = ({ data }: MessageEvent<unknown>) => {
          if (worker !== currentWorker) return;
          if (!data || typeof data !== "object" || !("id" in data) || typeof data.id !== "number") return;
          const entry = pending.get(data.id);
          if (!entry) return;
          pending.delete(data.id);
          if ("html" in data && typeof data.html === "string") entry.resolve(data.html);
          else
            entry.reject(
              new Error("error" in data && typeof data.error === "string" ? data.error : "Highlighting failed."),
            );
        };
        currentWorker.onerror = () => {
          if (worker === currentWorker) stop(new Error("Could not start Markdown highlighting. Try again."));
        };
        currentWorker.onmessageerror = () => {
          if (worker === currentWorker) stop(new Error("Could not read the Markdown worker response. Try again."));
        };
      } catch (error) {
        return Promise.reject(error);
      }
    }
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        worker!.postMessage({ ...message, id });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }

  return {
    highlight: (code: string, language?: string) => request({ operation: "highlight", code, language }),
    exportHtml: (source: string, settings: Readonly<Record<string, unknown>>) =>
      request({ operation: "export", source, settings, settingsSpec }),
    dispose: () => {
      stop(new DOMException("Preview was replaced.", "AbortError"));
    },
  };
}
