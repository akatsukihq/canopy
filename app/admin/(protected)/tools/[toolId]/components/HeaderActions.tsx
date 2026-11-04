"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Renders its children into the tool page header's action slot (see `page.tsx`). */
export function HeaderActions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById("tool-header-actions")), []);
  return slot ? createPortal(children, slot) : null;
}
