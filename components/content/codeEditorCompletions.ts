import { autocompletion, closeBrackets, closeBracketsKeymap, type CompletionSource } from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { lintKeymap } from "@codemirror/lint";

const COMPLETION_OPTIONS = { activateOnTypingDelay: 100, maxRenderedOptions: 50, icons: true };
const TS_LANGUAGES: Partial<Record<string, boolean>> = {
  js: true,
  javascript: true,
  jsx: true,
  ts: false,
  typescript: false,
  tsx: false,
};

type CompletionExtensions = { automatic: Extension; manual: Extension };
const loadedCompletions = new Map<string, Promise<CompletionExtensions>>();

async function build(language: string, ide: boolean): Promise<CompletionExtensions> {
  const support: Extension[] = [closeBrackets(), keymap.of([...closeBracketsKeymap, ...lintKeymap])];
  // `override` replaces the grammar's own suggestions when a richer source exists.
  let override: CompletionSource[] | undefined;
  if (language === "mermaid") {
    const { mermaidCompletionSource } = await import("./mermaidCompletions");
    support.push(EditorState.languageData.of(() => [{ autocomplete: mermaidCompletionSource }]));
  }
  const javascript = TS_LANGUAGES[language];
  if (ide && javascript !== undefined) {
    const { tsIntelligence } = await import("./tsIntelligence");
    const service = tsIntelligence(javascript);
    support.push(service.extension);
    override = [service.completion];
  }
  if (ide && (language === "css" || language === "html")) {
    const { cssLint, htmlLint } = await import("./webLint");
    support.push(language === "css" ? cssLint : htmlLint);
  }
  if (ide) {
    const { syntaxLintFor } = await import("./codeSyntaxLint");
    const lint = syntaxLintFor(language);
    if (lint) support.push(lint);
  }
  const { LANGUAGE_DATA } = await import("./codeLanguageData");
  const data = LANGUAGE_DATA[language];
  if (data) {
    const [{ symbolCompletionSource, documentWordSource, createSymbolProvider }, { ideExtensions }] = await Promise.all(
      [import("./codeSymbols"), import("./codeIntelligence")],
    );
    override = [symbolCompletionSource(data), documentWordSource(data)];
    if (ide) support.push(ideExtensions(() => createSymbolProvider(data)));
  }
  return {
    automatic: [...support, autocompletion({ ...COMPLETION_OPTIONS, override })],
    manual: [...support, autocompletion({ ...COMPLETION_OPTIONS, override, activateOnTyping: false })],
  };
}

/**
 * Imported only after page load and idle, when an editable editor is focused. `ide` adds hover docs,
 * go-to-definition, signature help and (for JS/TS) a TypeScript language-service worker.
 */
export function loadCodeEditorCompletions(language: string, ide = false): Promise<CompletionExtensions> {
  const key = `${language}:${ide}`;
  let loading = loadedCompletions.get(key);
  if (!loading) {
    loading = build(language, ide).catch((error: unknown) => {
      loadedCompletions.delete(key);
      throw error;
    });
    loadedCompletions.set(key, loading);
  }
  return loading;
}
