import type { SemanticSignal } from "@/renderer/lib/review/semantic-diff";

import { ArrowRight, Replace, Sparkles, WrapText } from "lucide-react";

interface SemanticDiffSummaryProps {
  signals: SemanticSignal[];
}

export function SemanticDiffSummary({ signals }: SemanticDiffSummaryProps) {
  if (signals.length === 0) {
    return null;
  }

  return (
    <div
      data-semantic-diff-summary
      className="border-border-accent bg-accent-muted/40 sticky top-0 z-[2] mx-3 mt-3 mb-1 flex flex-col gap-1.5 rounded-lg border px-3 py-2"
      style={{ boxShadow: "var(--shadow-glow)" }}
    >
      <div className="flex items-center gap-1.5">
        <Sparkles
          size={10}
          className="text-accent-text"
          strokeWidth={2}
        />
        <span className="text-accent-text font-mono text-[9px] font-semibold tracking-[0.08em] uppercase">
          Semantic summary
        </span>
        <span className="text-text-ghost font-mono text-[9px]">experimental</span>
      </div>
      <ul className="flex flex-col gap-1">
        {signals.map((signal, index) => (
          <li key={signalKey(signal, index)}>
            <SignalRow signal={signal} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function signalKey(signal: SemanticSignal, index: number): string {
  switch (signal.kind) {
    case "pure-rename": {
      return `pure-rename:${signal.from}->${signal.to}`;
    }
    case "whitespace-only": {
      return `whitespace:${signal.changedLines}`;
    }
    case "identifier-rename": {
      return `ident:${signal.from}->${signal.to}:${index}`;
    }
  }
}

function SignalRow({ signal }: { signal: SemanticSignal }) {
  switch (signal.kind) {
    case "pure-rename": {
      return (
        <div className="flex min-w-0 items-center gap-2 text-[11px]">
          <Replace
            size={11}
            className="text-accent-text shrink-0"
            strokeWidth={2}
          />
          <span className="text-text-primary font-medium">Pure rename</span>
          <span
            className="text-text-tertiary truncate font-mono text-[10px]"
            title={signal.from}
          >
            {signal.from}
          </span>
          <ArrowRight
            size={10}
            className="text-text-tertiary shrink-0"
            strokeWidth={2}
          />
          <span
            className="text-accent-text truncate font-mono text-[10px]"
            title={signal.to}
          >
            {signal.to}
          </span>
          <span className="text-text-ghost ml-auto shrink-0 font-mono text-[9px] tracking-wide uppercase">
            zero content changes
          </span>
        </div>
      );
    }
    case "whitespace-only": {
      return (
        <div className="flex min-w-0 items-center gap-2 text-[11px]">
          <WrapText
            size={11}
            className="text-info shrink-0"
            strokeWidth={2}
          />
          <span className="text-text-primary font-medium">Whitespace-only</span>
          <span className="text-text-secondary">
            formatting or indentation changed across{" "}
            <span className="text-text-primary font-mono">{signal.changedLines}</span> lines
          </span>
          <span className="text-text-ghost ml-auto shrink-0 font-mono text-[9px] tracking-wide uppercase">
            safe to skim
          </span>
        </div>
      );
    }
    case "identifier-rename": {
      return (
        <div className="flex min-w-0 items-center gap-2 text-[11px]">
          <Replace
            size={11}
            className="text-accent-text shrink-0"
            strokeWidth={2}
          />
          <span className="text-text-primary font-medium">Identifier rename</span>
          <span
            className="text-text-tertiary decoration-destructive/60 truncate font-mono text-[10px] line-through"
            title={signal.from}
          >
            {signal.from}
          </span>
          <ArrowRight
            size={10}
            className="text-text-tertiary shrink-0"
            strokeWidth={2}
          />
          <span
            className="text-accent-text truncate font-mono text-[10px]"
            title={signal.to}
          >
            {signal.to}
          </span>
          <span className="text-text-ghost ml-auto shrink-0 font-mono text-[9px] tracking-wide uppercase">
            {signal.occurrences}× occurrences
          </span>
        </div>
      );
    }
  }
}
