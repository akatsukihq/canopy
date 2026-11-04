"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/index.tsx";
import type { ToolAssistantSection } from "@/lib/tool-framework/toolAssistant";
import { ToolAssistantPanel, type AssistantTarget } from "./ToolAssistantPanel.tsx";

type TargetStore = {
  get: () => AssistantTarget | null;
  set: (target: AssistantTarget | null) => void;
  subscribe: (listener: () => void) => () => void;
};

function createTargetStore(): TargetStore {
  let target: AssistantTarget | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => target,
    set(next) {
      target = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

type Value = {
  store: TargetStore;
  open: boolean;
  setOpen: (open: boolean) => void;
  ownerId: string;
  toolId: string;
  section: ToolAssistantSection;
};

const ToolAssistantContext = createContext<Value | null>(null);

export function useToolAssistant(): Value | null {
  return useContext(ToolAssistantContext);
}

/** Each section form calls this with its current values; the panel reads them without re-rendering the form. */
export function useAssistantTarget(target: AssistantTarget): void {
  const assistant = useToolAssistant();
  const latest = useRef(target);
  latest.current = target;
  const store = assistant?.store;
  const signature = JSON.stringify([target.section, target.locale, target.activeKey, target.values]);
  useEffect(() => {
    store?.set({ ...latest.current, apply: (key, value) => latest.current.apply(key, value) });
  }, [store, signature]);
  useEffect(() => () => store?.set(null), [store]);
}

export function ToolAssistantProvider({
  children,
  ownerId,
  section,
  toolId,
}: {
  children: ReactNode;
  ownerId: string;
  section: ToolAssistantSection;
  toolId: string;
}) {
  const [store] = useState(createTargetStore);
  const [open, setOpen] = useState(false);
  return (
    <ToolAssistantContext.Provider value={{ store, open, setOpen, ownerId, toolId, section }}>
      {children}
    </ToolAssistantContext.Provider>
  );
}

export function ToolAssistantToggle() {
  const assistant = useToolAssistant();
  if (!assistant) return null;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-expanded={assistant.open}
            aria-label="AI assistant"
            onClick={() => assistant.setOpen(!assistant.open)}
            size="icon-sm"
            type="button"
            variant={assistant.open ? "secondary" : "outline"}
          >
            <Sparkles />
          </Button>
        </TooltipTrigger>
        <TooltipContent>AI assistant for this tool</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Lays the page body beside the collapsible assistant panel; closed, it takes no space. */
export function ToolAssistantDock({ children }: { children: ReactNode }) {
  const assistant = useToolAssistant();
  const target = useSyncExternalStore(
    assistant?.store.subscribe ?? (() => () => {}),
    () => assistant?.store.get() ?? null,
    () => null,
  );
  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      {assistant?.open ? (
        <aside
          aria-label="AI assistant"
          className="flex min-h-0 w-[340px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
        >
          <ToolAssistantPanel
            onClose={() => assistant.setOpen(false)}
            ownerId={assistant.ownerId}
            section={assistant.section}
            target={target}
            toolId={assistant.toolId}
          />
        </aside>
      ) : null}
    </div>
  );
}
