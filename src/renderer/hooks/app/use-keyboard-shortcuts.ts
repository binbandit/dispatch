import { useEffect, useRef } from "react";

/**
 * Centralized keyboard shortcut system.
 *
 * Rules:
 * - Non-modifier shortcuts never fire when focus is in input/textarea/contenteditable
 * - Modifier shortcuts can opt out while typing with `preventWhileTyping`
 * - Supports modifier keys (meta, shift, alt, ctrl)
 * - Shortcuts registered/unregistered on mount/unmount
 */

export interface Shortcut {
  key: string;
  modifiers?: Array<"meta" | "shift" | "alt" | "ctrl">;
  handler: () => void;
  /** Only fire if this returns true */
  when?: () => boolean;
  /** Prevent firing while focus is inside an input, textarea, or contenteditable region. */
  preventWhileTyping?: boolean;
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) {
    return false;
  }
  const tag = (el as HTMLElement).tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

function matchesModifiers(
  event: KeyboardEvent,
  modifiers: Array<"meta" | "shift" | "alt" | "ctrl"> = [],
): boolean {
  const wantMeta = modifiers.includes("meta");
  const wantShift = modifiers.includes("shift");
  const wantAlt = modifiers.includes("alt");
  const wantCtrl = modifiers.includes("ctrl");

  return (
    event.metaKey === wantMeta &&
    event.shiftKey === wantShift &&
    event.altKey === wantAlt &&
    event.ctrlKey === wantCtrl
  );
}

function matchesKey(event: KeyboardEvent, key: string): boolean {
  if (event.key.length === 1 && key.length === 1) {
    return event.key.toLowerCase() === key.toLowerCase();
  }

  return event.key === key;
}

export function useKeyboardShortcuts(shortcuts: Shortcut[]): void {
  // Use a ref so the handler always sees the latest shortcuts without re-registering
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Resolve the first shortcut whose key, modifiers, and focus policy all match.
      for (const shortcut of shortcutsRef.current) {
        const hasModifiers = shortcut.modifiers && shortcut.modifiers.length > 0;

        const skipShortcut =
          isInputFocused() && (shortcut.preventWhileTyping === true || !hasModifiers);

        if (
          !skipShortcut &&
          matchesKey(event, shortcut.key) &&
          matchesModifiers(event, shortcut.modifiers) &&
          (!shortcut.when || shortcut.when())
        ) {
          event.preventDefault();
          shortcut.handler();
          return;
        }
      }
    }

    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
