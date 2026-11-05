"use client";

import {
  createContext,
  type CSSProperties,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Sparkles } from "lucide-react";
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/index.tsx";
import { cn } from "@/components/ui/lib/utils.ts";
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
    <div className="flex items-center rounded-lg bg-muted p-0.5" role="group" aria-label="Panels">
      <Button
        aria-controls="tool-assistant"
        aria-expanded={assistant.open}
        className={cn(
          "gap-1.5 rounded-md px-2 font-medium",
          assistant.open && "bg-accent text-accent-text hover:bg-accent",
        )}
        onClick={() => assistant.setOpen(!assistant.open)}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Sparkles aria-hidden="true" />
        Assistant
      </Button>
    </div>
  );
}

/**
 * The tabs and page body, with the assistant sliding in from the right edge of that area (like the blog
 * editor). The header stays visible; on wide screens the content makes room instead of sitting underneath.
 */
export function ToolAssistantDock({ children }: { children: ReactNode }) {
  const assistant = useToolAssistant();
  const target = useSyncExternalStore(
    assistant?.store.subscribe ?? (() => () => {}),
    () => assistant?.store.get() ?? null,
    () => null,
  );
  const open = assistant?.open ?? false;
  // Mount on first open so the page does not load assistant history unless it is used; keep it after.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-clip">
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-3 transition-[padding] duration-300 motion-reduce:transition-none",
          open && "lg:pr-[366px]",
        )}
      >
        {children}
      </div>
      {assistant && mounted ? (
        <aside
          aria-hidden={!open}
          aria-label="Assistant"
          className={cn(
            "absolute inset-y-0 right-0 z-20 flex w-full min-h-0 flex-col overflow-clip rounded-xl border border-border bg-muted transition-[transform,visibility] duration-300 ease-out motion-reduce:transition-none sm:w-[350px]",
            open ? "visible translate-x-0" : "invisible translate-x-[105%]",
          )}
          id="tool-assistant"
          // White panel with grey inner surfaces: swap the two surface tokens inside it (the app is light-only; values match globals.css).
          style={{ "--card": "#f6f7f9", "--muted": "#ffffff" } as CSSProperties}
          inert={!open}
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
