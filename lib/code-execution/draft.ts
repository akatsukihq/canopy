/**
 * Per-tool source draft kept in localStorage so a reload does not lose work.
 * Storage can be missing or throw (private windows, blocked site data), so every
 * access is guarded and the page works without it.
 */

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PREFIX = "canopy:code-draft:";

/** The browser's storage, or null when it is unavailable. */
export function browserDraftStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadDraft(storage: DraftStorage | null, definitionKey: string): string | null {
  try {
    const value = storage?.getItem(PREFIX + definitionKey);
    return value && value.trim() !== "" ? value : null;
  } catch {
    return null;
  }
}

/** Saves the draft, or removes it when there is nothing worth restoring. */
export function saveDraft(storage: DraftStorage | null, definitionKey: string, text: string, starter: string): void {
  try {
    if (text.trim() === "" || text === starter) storage?.removeItem(PREFIX + definitionKey);
    else storage?.setItem(PREFIX + definitionKey, text);
  } catch {
    // Quota or blocked storage: the editor keeps working, only the reload restore is lost.
  }
}

export function clearDraft(storage: DraftStorage | null, definitionKey: string): void {
  saveDraft(storage, definitionKey, "", "");
}
