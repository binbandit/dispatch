import type { CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Terminal } from "lucide-react";

/**
 * Environment check error screen (SPEC.md § 4.3).
 *
 * Shown when `gh` or `git` is not installed, or `gh` is not authenticated.
 * Prompts the user to install or authenticate in their terminal.
 */

interface EnvCheckProps {
  ghVersion: string | null;
  gitVersion: string | null;
  ghAuth: boolean;
  onRetry: () => void;
}

export const ENV_CHECK_WINDOW_DRAG_STYLE = { WebkitAppRegion: "drag" } as CSSProperties;
export const ENV_CHECK_WINDOW_NO_DRAG_STYLE = { WebkitAppRegion: "no-drag" } as CSSProperties;

export function EnvCheck({ ghVersion, gitVersion, ghAuth, onRetry }: EnvCheckProps) {
  const issues: Array<{ title: string; description: string; command: string }> = [];

  if (!gitVersion) {
    issues.push({
      title: "Git not found",
      description: "Dispatch requires Git to be installed on your system.",
      command: "brew install git",
    });
  }

  if (!ghVersion) {
    issues.push({
      title: "GitHub CLI not found",
      description: "Dispatch requires the GitHub CLI (gh) for fetching PRs, checks, and merging.",
      command: "brew install gh",
    });
  } else if (!ghAuth) {
    issues.push({
      title: "GitHub CLI not authenticated",
      description:
        "You need to authenticate the GitHub CLI before Dispatch can access your repositories.",
      command: "gh auth login",
    });
  }

  if (issues.length === 0) {
    return null;
  }

  return (
    <div
      className="bg-bg-root relative flex h-screen flex-col items-center justify-center gap-8 overflow-hidden px-8"
      style={ENV_CHECK_WINDOW_DRAG_STYLE}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: 0.015,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "256px 256px",
        }}
      />
      <div
        className="pointer-events-none absolute top-0 left-0 h-[2px] w-full"
        style={{
          background: "linear-gradient(90deg, transparent, var(--primary), transparent)",
          opacity: 0.4,
        }}
      />

      {/* Display heading (§ 10.5 Empty states) */}
      <div className="relative z-10 flex flex-col items-center gap-3">
        <div className="bg-warning-muted flex h-12 w-12 items-center justify-center rounded-lg">
          <AlertTriangle
            size={24}
            className="text-warning"
          />
        </div>
        <h1 className="font-heading text-text-primary text-4xl italic">Almost there</h1>
        <p className="text-text-secondary max-w-md text-center text-[13px] leading-relaxed">
          Dispatch needs a few tools to be set up on your machine before it can connect to GitHub.
        </p>
      </div>

      {/* Issue cards */}
      <div
        className="relative z-10 flex w-full max-w-lg flex-col gap-3"
        style={ENV_CHECK_WINDOW_NO_DRAG_STYLE}
      >
        {issues.map((issue) => (
          <div
            key={issue.title}
            className="border-border bg-bg-raised rounded-lg border p-4"
          >
            <h3 className="text-text-primary text-[13px] font-semibold">{issue.title}</h3>
            <p className="text-text-secondary mt-1 text-xs">{issue.description}</p>
            <div className="border-border bg-bg-root mt-3 flex items-center gap-2 rounded-md border px-3 py-2">
              <Terminal
                size={12}
                className="text-text-tertiary shrink-0"
              />
              <code className="text-accent-text font-mono text-xs">{issue.command}</code>
            </div>
          </div>
        ))}
      </div>

      <div
        className="relative z-10 flex flex-col items-center gap-3"
        style={ENV_CHECK_WINDOW_NO_DRAG_STYLE}
      >
        <Button
          variant="outline"
          onClick={onRetry}
          style={ENV_CHECK_WINDOW_NO_DRAG_STYLE}
        >
          <RefreshCw size={14} />
          Retry
        </Button>
        <p className="text-text-tertiary text-[11px]">
          Run the commands above in your terminal, then retry.
        </p>
      </div>
    </div>
  );
}
