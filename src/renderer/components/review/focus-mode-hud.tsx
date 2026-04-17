import { Kbd } from "@/components/ui/kbd";
import { toastManager } from "@/components/ui/toast";
import { useRouter } from "@/renderer/lib/app/router";
import {
  formatFocusDuration,
  useFocusMode,
  useFocusModeStore,
} from "@/renderer/lib/review/focus-mode-store";
import { ArrowRight, Focus, X } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Floating HUD for the experimental focus-mode review session.
 *
 * Keeps the reviewer in a steady cadence by pinning a minimal dashboard to the
 * bottom of the window: elapsed timer, progress dots, the next PR preview, and
 * chord hints for advancing or exiting.
 */
export function FocusModeHud() {
  const { active, queue, currentIndex, startedAt, reviewed } = useFocusMode();
  const { navigate } = useRouter();
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!active) {
      return;
    }
    const update = () => setElapsedMs(Date.now() - startedAt);
    update();
    const interval = globalThis.setInterval(update, 1000);
    return () => globalThis.clearInterval(interval);
  }, [active, startedAt]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "Escape" && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
        event.preventDefault();
        exitFocusMode();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        advanceFocusMode(navigate);
      }
    };

    globalThis.addEventListener("keydown", handleKey);
    return () => globalThis.removeEventListener("keydown", handleKey);
  }, [active, navigate]);

  if (!active || queue.length === 0) {
    return null;
  }

  const currentPr = queue[currentIndex];
  const nextPr = queue[currentIndex + 1] ?? null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div
        className="border-border-accent bg-bg-elevated pointer-events-auto flex w-[520px] max-w-full flex-col gap-2 rounded-xl border px-4 py-3"
        style={{ boxShadow: "var(--shadow-lg), var(--shadow-glow)" }}
        role="status"
        aria-label="Focus mode session"
      >
        <div className="flex items-center gap-3">
          <div className="border-border-accent bg-accent-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-md border">
            <Focus
              size={13}
              className="text-accent-text"
              strokeWidth={2.25}
            />
          </div>

          <div className="flex flex-1 flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <span className="text-accent-text font-mono text-[9px] font-semibold tracking-[0.08em] uppercase">
                Focus session
              </span>
              <span className="text-text-tertiary font-mono text-[10px]">
                PR {currentIndex + 1} of {queue.length}
              </span>
            </div>
            {currentPr && (
              <div className="flex items-center gap-1.5">
                <span className="text-text-tertiary font-mono text-[10px]">
                  #{currentPr.number}
                </span>
                <span className="text-text-primary truncate text-[12px] font-medium">
                  {currentPr.title}
                </span>
              </div>
            )}
          </div>

          <div
            className="font-display text-text-primary text-[28px] leading-none tracking-tight italic tabular-nums"
            aria-label="Elapsed"
          >
            {formatFocusDuration(elapsedMs)}
          </div>
        </div>

        <ProgressDots
          total={queue.length}
          current={currentIndex}
          reviewed={reviewed}
        />

        <div className="mt-0.5 flex items-center gap-3 text-[10px]">
          {nextPr ? (
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <ArrowRight
                size={10}
                className="text-text-tertiary shrink-0"
                strokeWidth={2}
              />
              <span className="text-text-tertiary font-mono">Next #{nextPr.number}</span>
              <span className="text-text-secondary truncate">{nextPr.title}</span>
            </div>
          ) : (
            <span className="text-text-tertiary flex-1 truncate italic">
              Queue end — exit to wrap up
            </span>
          )}

          <div className="flex shrink-0 items-center gap-2">
            <span className="text-text-tertiary flex items-center gap-1 font-mono text-[10px]">
              <Kbd>⌘⇧N</Kbd> next
            </span>
            <span className="text-text-tertiary flex items-center gap-1 font-mono text-[10px]">
              <Kbd>Esc</Kbd> exit
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => exitFocusMode()}
          className="border-border bg-bg-raised text-text-tertiary hover:border-border-strong hover:bg-bg-elevated hover:text-text-primary absolute -top-2.5 -right-2.5 flex h-5 w-5 items-center justify-center rounded-full border transition-colors"
          aria-label="Exit focus mode"
        >
          <X
            size={11}
            strokeWidth={2.25}
          />
        </button>
      </div>
    </div>
  );
}

function ProgressDots({
  total,
  current,
  reviewed,
}: {
  total: number;
  current: number;
  reviewed: number;
}) {
  return (
    <ol
      aria-hidden
      className="flex items-center gap-1"
    >
      {Array.from({ length: total }, (_, index) => {
        const isReviewed = index < reviewed;
        const isCurrent = index === current;
        return (
          <li
            key={index}
            className={
              isCurrent
                ? "bg-accent h-1.5 w-6 rounded-full"
                : isReviewed
                  ? "bg-accent-text/60 h-1.5 w-1.5 rounded-full"
                  : "bg-border-strong h-1.5 w-1.5 rounded-full"
            }
          />
        );
      })}
    </ol>
  );
}

export function advanceFocusMode(navigate: (route: { view: "review"; prNumber: number }) => void) {
  const nextPr = useFocusModeStore.getState().advance();
  if (nextPr) {
    navigate({ view: "review", prNumber: nextPr.number });
  } else {
    exitFocusMode();
  }
}

function exitFocusMode() {
  const { reviewed, total, elapsedMs } = useFocusModeStore.getState().exit();
  const minutes = Math.floor(elapsedMs / 60_000);
  const seconds = Math.floor((elapsedMs % 60_000) / 1000);
  toastManager.add({
    title: "Focus session ended",
    description: `Reviewed ${reviewed} of ${total} in ${minutes}m ${String(seconds).padStart(2, "0")}s`,
    type: "success",
  });
}
