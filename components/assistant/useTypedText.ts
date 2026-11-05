"use client";

import { useEffect, useState } from "react";

/** Characters already revealed per key, so a remount (stream → saved message) continues instead of restarting. */
const revealed = new Map<string, number>();

/**
 * Reveals `text` progressively, like typing, for text that arrives while it is on screen.
 * `key` null shows the text at once (loaded history). Speed scales with the backlog so
 * long replies finish in about a second and a half. Reduced motion shows text at once.
 */
export function useTypedText(text: string, key: string | null): string {
  if (key && !revealed.has(key)) revealed.set(key, 0);
  const [shown, setShown] = useState(() => (key ? (revealed.get(key) ?? 0) : text.length));
  const reduced =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const animate = !!key && !reduced;

  useEffect(() => {
    if (!animate || shown >= text.length) return;
    const timer = setTimeout(() => {
      const next = Math.min(text.length, shown + Math.max(2, Math.ceil((text.length - shown) / 45)));
      revealed.set(key!, next);
      setShown(next);
    }, 16);
    return () => clearTimeout(timer);
  }, [animate, key, shown, text.length]);

  return animate ? text.slice(0, shown) : text;
}
