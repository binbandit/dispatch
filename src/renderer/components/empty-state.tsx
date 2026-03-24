/**
 * Empty state — shown when no PR is selected.
 *
 * Matches v14 mockup: radial copper gradient, display heading,
 * ghost activity feed, and keyboard shortcut hints.
 */
export function EmptyState() {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-2">
      {/* Radial copper gradient glow */}
      <div
        className="pointer-events-none absolute top-1/2 left-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2"
        style={{
          background:
            "radial-gradient(circle, rgba(212, 136, 58, 0.04) 0%, transparent 70%)",
        }}
      />

      {/* Title */}
      <h2 className="font-heading text-text-primary relative z-[1] text-4xl italic tracking-[-0.03em]">
        Select a PR
      </h2>

      {/* Description */}
      <p className="text-text-tertiary relative z-[1] max-w-[280px] text-center text-[13px]">
        Choose a pull request from your queue to start reviewing.
      </p>

      {/* Ghost activity feed */}
      <div className="relative z-[1] mt-3 flex flex-col gap-1">
        <GhostActivity author="sarah-dev" action="opened" number="#247" time="2h ago" />
        <GhostActivity author="alex-k" action="approved" number="#241" time="5h ago" />
        <GhostActivity author="CI passed" action="on" number="#245" time="3h ago" />
      </div>

      {/* Keyboard shortcuts */}
      <div className="text-text-ghost relative z-[1] mt-4 flex items-center gap-1.5 text-[11px]">
        <Kbd>j</Kbd>
        <Kbd>k</Kbd>
        <span>navigate</span>
        <span className="ml-1" />
        <Kbd>Enter</Kbd>
        <span>open</span>
      </div>
    </div>
  );
}

function GhostActivity({
  author,
  action,
  number,
  time,
}: {
  author: string;
  action: string;
  number: string;
  time: string;
}) {
  return (
    <div className="text-text-ghost text-center text-[11px] tracking-[-0.01em]">
      <span className="font-medium">{author}</span> {action}{" "}
      <span className="font-mono text-[10px]">{number}</span>
      <span className="font-mono ml-0.5 text-[10px]">&mdash; {time}</span>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="border-border-strong bg-bg-raised text-text-ghost inline-flex min-w-[20px] items-center justify-center rounded-sm border px-[5px] py-0 font-mono text-[10px] font-medium shadow-[0_1px_0_var(--border)] h-5">
      {children}
    </kbd>
  );
}
