import { useEffect, useRef } from "react";

/**
 * Centralized keyboard shortcut system.
 *
 * Rules:
 * - Non-modifier shortcuts never fire when focus is in input/textarea/contenteditable
 * - Modifier shortcuts can opt out while typing with `preventWhileTyping`
 * - Supports short multi-key sequences such as `g` then `q`
 * - Supports modifier keys (meta, shift, alt, ctrl)
 * - Shortcuts registered/unregistered on mount/unmount
 */

type Modifier = "meta" | "shift" | "alt" | "ctrl";
type KeySequence = [string, ...string[]];

interface BaseShortcut {
  handler: () => void;
  /** Only fire if this returns true */
  when?: () => boolean;
  /** Prevent firing while focus is inside an input, textarea, or contenteditable region. */
  preventWhileTyping?: boolean;
}

interface SingleKeyShortcut extends BaseShortcut {
  key: string;
  modifiers?: Array<"meta" | "shift" | "alt" | "ctrl">;
  sequence?: never;
}

interface KeySequenceShortcut extends BaseShortcut {
  key?: never;
  modifiers?: never;
  sequence: KeySequence;
}

export type Shortcut = SingleKeyShortcut | KeySequenceShortcut;

interface ActiveSequence {
  candidates: KeySequenceShortcut[];
  nextIndex: number;
}

const SEQUENCE_TIMEOUT_MS = 1200;

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) {
    return false;
  }
  const tag = (el as HTMLElement).tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

function matchesModifiers(event: KeyboardEvent, modifiers: Modifier[] = []): boolean {
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

function isSequenceShortcut(shortcut: Shortcut): shortcut is KeySequenceShortcut {
  return "sequence" in shortcut;
}

function shouldSkipShortcut(shortcut: Shortcut, inputFocused: boolean): boolean {
  if (!inputFocused) {
    return false;
  }

  const hasModifiers = !isSequenceShortcut(shortcut) && (shortcut.modifiers?.length ?? 0) > 0;
  return shortcut.preventWhileTyping === true || !hasModifiers;
}

export function useKeyboardShortcuts(shortcuts: Shortcut[]): void {
  // Use a ref so the handler always sees the latest shortcuts without re-registering
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;
  const activeSequenceRef = useRef<ActiveSequence | null>(null);
  const sequenceTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  useEffect(() => {
    function clearSequence(): void {
      activeSequenceRef.current = null;
      if (sequenceTimerRef.current !== null) {
        globalThis.clearTimeout(sequenceTimerRef.current);
        sequenceTimerRef.current = null;
      }
    }

    function armSequence(candidates: KeySequenceShortcut[], nextIndex: number): void {
      activeSequenceRef.current = { candidates, nextIndex };
      if (sequenceTimerRef.current !== null) {
        globalThis.clearTimeout(sequenceTimerRef.current);
      }
      sequenceTimerRef.current = globalThis.setTimeout(() => {
        activeSequenceRef.current = null;
        sequenceTimerRef.current = null;
      }, SEQUENCE_TIMEOUT_MS);
    }

    function onKeyDown(event: KeyboardEvent) {
      const inputFocused = isInputFocused();
      const activeSequence = activeSequenceRef.current;

      if (activeSequence) {
        if (event.repeat) {
          return;
        }

        if (event.key === "Escape") {
          clearSequence();
          return;
        }

        const matchingCandidates = activeSequence.candidates.filter((shortcut) => {
          if (shouldSkipShortcut(shortcut, inputFocused)) {
            return false;
          }
          if (shortcut.when && !shortcut.when()) {
            return false;
          }
          const nextKey = shortcut.sequence[activeSequence.nextIndex];
          return nextKey ? matchesKey(event, nextKey) : false;
        });

        if (matchingCandidates.length > 0) {
          event.preventDefault();
          const completedShortcut = matchingCandidates.find(
            (shortcut) => shortcut.sequence.length === activeSequence.nextIndex + 1,
          );

          if (completedShortcut) {
            clearSequence();
            completedShortcut.handler();
            return;
          }

          armSequence(matchingCandidates, activeSequence.nextIndex + 1);
          return;
        }

        clearSequence();
      }

      const sequenceStarters = shortcutsRef.current.filter(
        (shortcut): shortcut is KeySequenceShortcut => {
          if (!isSequenceShortcut(shortcut)) {
            return false;
          }
          if (shouldSkipShortcut(shortcut, inputFocused)) {
            return false;
          }
          if (shortcut.when && !shortcut.when()) {
            return false;
          }
          return matchesKey(event, shortcut.sequence[0]);
        },
      );

      if (sequenceStarters.length > 0) {
        event.preventDefault();
        const completedShortcut = sequenceStarters.find(
          (shortcut) => shortcut.sequence.length === 1,
        );

        if (completedShortcut) {
          clearSequence();
          completedShortcut.handler();
          return;
        }

        armSequence(sequenceStarters, 1);
        return;
      }

      // Resolve the first single-key shortcut whose key, modifiers, and focus policy all match.
      for (const shortcut of shortcutsRef.current) {
        if (
          !isSequenceShortcut(shortcut) &&
          !shouldSkipShortcut(shortcut, inputFocused) &&
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
      clearSequence();
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
