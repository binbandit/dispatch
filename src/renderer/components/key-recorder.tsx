import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatKeybinding, type Modifier } from "../lib/keybinding-registry";

/**
 * Key recorder — captures a keypress for keybinding configuration.
 *
 * Idle: shows the current binding as a styled kbd.
 * Recording: pulsing accent border, captures next non-modifier keydown.
 * Escape cancels. Modifier-only presses are ignored.
 */

interface KeyRecorderProps {
  currentKey: string;
  currentModifiers?: Modifier[];
  isCustomized: boolean;
  onRecord: (key: string, modifiers?: Modifier[]) => void;
  onReset: () => void;
}

const MODIFIER_KEYS = new Set(["Meta", "Shift", "Alt", "Control", "CapsLock", "Fn"]);

export function KeyRecorder({
  currentKey,
  currentModifiers,
  isCustomized,
  onRecord,
  onReset,
}: KeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const startRecording = useCallback(() => {
    setRecording(true);
  }, []);

  useEffect(() => {
    if (!recording) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();

      // Escape cancels recording
      if (event.key === "Escape") {
        setRecording(false);
        return;
      }

      // Ignore modifier-only presses — wait for an actual key
      if (MODIFIER_KEYS.has(event.key)) {
        return;
      }

      const modifiers: Modifier[] = [];
      if (event.metaKey) {
        modifiers.push("meta");
      }
      if (event.shiftKey) {
        modifiers.push("shift");
      }
      if (event.altKey) {
        modifiers.push("alt");
      }
      if (event.ctrlKey) {
        modifiers.push("ctrl");
      }

      onRecord(event.key, modifiers.length > 0 ? modifiers : undefined);
      setRecording(false);
    }

    // Use capture to intercept before other shortcut handlers
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, onRecord]);

  const display = formatKeybinding(currentKey, currentModifiers);

  return (
    <div className="flex items-center gap-1.5">
      {isCustomized && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onReset}
                className="text-text-ghost hover:text-text-tertiary cursor-pointer transition-colors"
              >
                <RotateCcw size={11} />
              </button>
            }
          />
          <TooltipPopup>Reset to default</TooltipPopup>
        </Tooltip>
      )}
      <button
        ref={buttonRef}
        type="button"
        onClick={startRecording}
        className={`border-border-strong bg-bg-raised text-text-secondary min-w-[48px] cursor-pointer rounded-md border px-2 py-1 font-mono text-[11px] font-medium transition-all ${
          recording
            ? "animate-pulse border-[--border-accent] text-[--accent-text] shadow-[0_0_0_1px_var(--border-accent)]"
            : "shadow-[0_1px_0_var(--border)] hover:border-[--border-strong] hover:bg-[--bg-elevated]"
        }`}
      >
        {recording ? "..." : display}
      </button>
    </div>
  );
}
