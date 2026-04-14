import { ipc } from "@/renderer/lib/app/ipc";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { useCallback, useEffect, useRef, useState } from "react";

const CHECK_INTERVAL_MS = 30_000;

/**
 * Monitors whether the active workspace's local folder still exists.
 * Checks on window focus and at a slow interval.
 * Returns `true` when the path was valid but is now missing.
 */
export function useWorkspacePathMonitor(): {
  pathMissing: boolean;
  dismiss: () => void;
  recheck: () => Promise<boolean>;
} {
  const { id, cwd } = useWorkspace();
  const [pathMissing, setPathMissing] = useState(false);
  const dismissedForIdRef = useRef<number | null>(null);

  const check = useCallback(async () => {
    if (!cwd) {
      return false;
    }
    try {
      const exists = await ipc("workspace.checkPath", { id });
      if (!exists && dismissedForIdRef.current !== id) {
        setPathMissing(true);
      }
      if (exists) {
        setPathMissing(false);
        dismissedForIdRef.current = null;
      }
      return !exists;
    } catch {
      return false;
    }
  }, [id, cwd]);

  const dismiss = useCallback(() => {
    dismissedForIdRef.current = id;
    setPathMissing(false);
  }, [id]);

  // Check on visibility change (user switches back to app)
  useEffect(() => {
    if (!cwd) {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void check();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Also check on mount
    void check();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [cwd, check]);

  // Slow interval as fallback
  useEffect(() => {
    if (!cwd) {
      return;
    }
    const timer = setInterval(() => {
      void check();
    }, CHECK_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [cwd, check]);

  // Reset when workspace changes
  useEffect(() => {
    setPathMissing(false);
    dismissedForIdRef.current = null;
  }, [id]);

  return { pathMissing, dismiss, recheck: check };
}
