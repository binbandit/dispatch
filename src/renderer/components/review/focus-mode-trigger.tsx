import { useKeyboardShortcuts } from "@/renderer/hooks/app/use-keyboard-shortcuts";
import { usePreference } from "@/renderer/hooks/preferences/use-preference";
import { useKeybindings } from "@/renderer/lib/keyboard/keybinding-context";
import { useFocusModeStore, type FocusModePr } from "@/renderer/lib/review/focus-mode-store";
import { isExperimentalFeatureEnabled } from "@/shared/experimental-features";
import { Focus } from "lucide-react";

interface FocusModeTriggerProps {
  queue: FocusModePr[];
  onEnter: (firstPr: FocusModePr) => void;
}

/**
 * Icon button that starts a focus-mode session over the current PR queue.
 * Rendered only when the experimental flag is on. Also wires the shortcut
 * so the session can start without reaching for the mouse.
 */
export function FocusModeTrigger({ queue, onEnter }: FocusModeTriggerProps) {
  const preference = usePreference("experimentalFocusMode");
  const enabled = isExperimentalFeatureEnabled(preference);
  const { getBinding } = useKeybindings();
  const active = useFocusModeStore((state) => state.active);

  const startSession = () => {
    if (queue.length === 0 || active) {
      return;
    }
    useFocusModeStore.getState().enter(queue);
    const [firstPr] = queue;
    if (firstPr) {
      onEnter(firstPr);
    }
  };

  useKeyboardShortcuts(
    enabled ? [{ ...getBinding("actions.focusMode"), handler: startSession }] : [],
  );

  if (!enabled) {
    return null;
  }

  const disabled = queue.length === 0 || active;

  return (
    <button
      type="button"
      onClick={startSession}
      disabled={disabled}
      aria-label="Start focus-mode review"
      title={
        active
          ? "Focus session in progress"
          : queue.length === 0
            ? "No PRs in queue"
            : `Start focus session (${queue.length} PRs)`
      }
      className="border-border bg-bg-raised text-text-tertiary hover:border-border-accent hover:bg-accent-muted hover:text-accent-text focus-visible:border-border-accent focus-visible:bg-accent-muted focus-visible:text-accent-text disabled:hover:border-border disabled:hover:bg-bg-raised disabled:hover:text-text-tertiary flex h-6 w-6 items-center justify-center rounded-md border transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Focus
        size={11}
        strokeWidth={2.25}
      />
    </button>
  );
}
