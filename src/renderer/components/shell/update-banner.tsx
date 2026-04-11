import { Button } from "@/components/ui/button";
import { ipc } from "@/renderer/lib/app/ipc";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, X } from "lucide-react";
import { useRef, useState } from "react";

/** Default traffic light position (no banner). */
const TRAFFIC_LIGHT_DEFAULT = { x: 16, y: 14 };
/** Traffic light position when banner is visible (centered in 36px banner). */
const TRAFFIC_LIGHT_BANNER = { x: 16, y: 12 };

/**
 * Dev-only repo update banner.
 *
 * When Dispatch is running from the source repository via `bun run dev`,
 * poll the local checkout's upstream tracking branch and surface when the
 * current branch is behind. Packaged builds and non-repo runs stay silent.
 */
export function UpdateBanner({
  onVisibilityChange,
  isFullscreen,
}: {
  onVisibilityChange?: (visible: boolean) => void;
  isFullscreen: boolean;
}) {
  const isMac = globalThis.navigator?.platform?.includes("Mac") ?? false;
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const prevFullscreenRef = useRef(false);

  const statusQuery = useQuery({
    queryKey: ["app", "dev-repo-status"],
    queryFn: () => ipc("app.devRepoStatus", { cwd: null }),
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const status = statusQuery.data ?? null;
  const bannerKey =
    status?.enabled && status.currentBranch && status.upstreamBranch
      ? [status.currentBranch, status.upstreamBranch, status.aheadCount, status.behindCount].join(
          ":",
        )
      : null;

  const visible =
    Boolean(status?.enabled) &&
    Boolean(status?.hasUpdates) &&
    Boolean(status?.currentBranch) &&
    Boolean(status?.upstreamBranch) &&
    Boolean(bannerKey) &&
    dismissedKey !== bannerKey;

  // Notify parent of visibility changes during render (no effect needed).
  // This is safe because the call is conditional — it only fires on transitions.
  const prevVisibleRef = useRef(visible);
  const trafficLightPosition =
    visible && isMac && !isFullscreen ? TRAFFIC_LIGHT_BANNER : TRAFFIC_LIGHT_DEFAULT;

  if (prevVisibleRef.current !== visible || prevFullscreenRef.current !== isFullscreen) {
    if (prevVisibleRef.current !== visible) {
      onVisibilityChange?.(visible);
    }
    prevVisibleRef.current = visible;
    prevFullscreenRef.current = isFullscreen;

    // Reposition macOS traffic lights to center in the banner or navbar
    void ipc("app.setTrafficLightPosition", trafficLightPosition);
  }

  if (!visible || !status) {
    return null;
  }

  const commitLabel = status.behindCount === 1 ? "1 commit" : `${status.behindCount} commits`;

  return (
    <div
      className={`border-border-accent bg-accent-muted/90 flex min-h-9 shrink-0 items-center gap-3 border-b py-1.5 pr-4 shadow-sm ${
        isMac && isFullscreen ? "pl-4" : "pl-24"
      }`}
    >
      <div className="bg-bg-root/45 border-border-accent flex h-6 w-6 shrink-0 items-center justify-center rounded-full border">
        <GitBranch
          size={13}
          className="text-accent-text"
        />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-text-primary text-[12px] leading-4">
          <span className="text-accent-text font-medium">Update available</span>
          <span className="text-text-tertiary mx-1">·</span>
          <span className="text-text-secondary font-mono text-[10px]">
            {status.currentBranch}
          </span>{" "}
          is {commitLabel} behind{" "}
          <span className="text-accent-text font-mono text-[10px]">{status.upstreamBranch}</span>
        </p>
      </div>

      <div className="border-border-accent bg-bg-root/45 text-text-secondary hidden items-center gap-1 rounded-full border px-2 py-1 font-mono text-[10px] md:flex">
        <span>ahead {status.aheadCount}</span>
        <span className="text-text-ghost">/</span>
        <span className="text-accent-text">behind {status.behindCount}</span>
      </div>

      <Button
        size="xs"
        variant="ghost"
        className="text-accent-text hover:bg-bg-root/45 h-6 rounded-sm border border-transparent px-2 text-[10px] font-medium"
        onClick={() => setDismissedKey(bannerKey)}
      >
        Dismiss
      </Button>

      <button
        type="button"
        aria-label="Dismiss repo update banner"
        onClick={() => setDismissedKey(bannerKey)}
        className="text-text-tertiary hover:text-accent-text hover:bg-bg-root/45 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-sm transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  );
}
