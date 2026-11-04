"use client";

import dynamic from "next/dynamic";
import { WrapText } from "lucide-react";
import { useState, type AriaAttributes, type Ref } from "react";

import { Button } from "@/components/ui/components/button.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/components/tooltip.tsx";
import { cn } from "@/components/ui/lib/utils.ts";

export interface CodeEditorHandle {
  focus(): void;
  readonly scrollDOM: HTMLElement;
  scrollToLine(line: number, column?: number): void;
}

/** Run affordances: a button beside each runnable range and a context menu with run and edit actions. */
export interface CodeEditorRunActions {
  /** Character ranges that can run on their own, e.g. one SQL statement each. */
  find(source: string): readonly { readonly from: number; readonly to: number }[];
  onRun(range: { readonly from: number; readonly to: number }): void;
  onRunAll(): void;
  /** Optional: show how a range would execute, without running it for real. */
  onExplain?(range: { readonly from: number; readonly to: number }, mode: "plan" | "bytecode"): void;
  labels: {
    run: string;
    runStatement: string;
    runSelection: string;
    runAll: string;
    explain?: string;
    explainPlan?: string;
    cut: string;
    copy: string;
    paste: string;
    selectAll: string;
  };
}

export interface CodeEditorProps extends Pick<
  AriaAttributes,
  "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-invalid"
> {
  value: string;
  language: string;
  onChange?: (value: string) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
  showLineNumbers?: boolean;
  colorPreviews?: boolean;
  wrap?: "soft" | "hard" | "off";
  onCaretChange?: (position: { line: number; column: number }) => void;
  onScroll?: (scroller: HTMLElement) => void;
  editorRef?: Ref<CodeEditorHandle>;
  scrollRef?: Ref<HTMLElement>;
  searchQuery?: string;
  activeMatch?: { from: number; to: number };
  /** VS Code-style hover docs, go-to-definition, signature help and, for JS/TS, type checking. */
  ide?: boolean;
  runActions?: CodeEditorRunActions;
}

const LazyCodeEditor = dynamic(() => import("./CodeEditorImpl"), {
  ssr: false,
  loading: () => (
    <div className="p-4 text-sm text-muted-foreground" role="status">
      Loading editor…
    </div>
  ),
});

export function CodeEditor({ className, ...props }: CodeEditorProps) {
  const [wrapOverride, setWrapOverride] = useState<boolean | null>(null);
  const language = props.language.trim().toLowerCase();
  const delimited = language === "csv" || language === "tsv";
  const wrapped =
    wrapOverride ??
    (props.wrap
      ? props.wrap !== "off"
      : language === "jwt" || language === "qr" || language === "url" || (delimited && Boolean(props.onChange)));
  return (
    <div className={cn("relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden", className)}>
      <div className="absolute top-1 right-2 z-10">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Wrap lines"
                aria-pressed={wrapped}
                className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                onClick={() => setWrapOverride(!wrapped)}
                size="icon-xs"
                variant="input-icon"
              >
                <WrapText aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {wrapped ? "Text wrapping on · Click to disable" : "Text wrapping off · Click to enable"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        <LazyCodeEditor {...props} wrap={wrapped ? "soft" : "off"} />
      </div>
    </div>
  );
}
