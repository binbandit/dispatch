import type { GhPrListItem } from "../../shared/ipc";

import { getActiveWorkspace, getWorkspaces } from "../db/repository";
import { listPrs } from "./gh-cli";

/**
 * Background PR polling for the tray icon.
 *
 * Runs independently of the renderer — keeps updating even when
 * the window is closed/hidden. Polls the active workspace.
 */

export interface TrayState {
  reviewPrs: GhPrListItem[];
  authorPrs: GhPrListItem[];
  lastUpdated: Date;
}

let state: TrayState = {
  reviewPrs: [],
  authorPrs: [],
  lastUpdated: new Date(),
};

let pollInterval: ReturnType<typeof setInterval> | null = null;

export function getTrayState(): TrayState {
  return state;
}

export async function pollOnce(): Promise<TrayState> {
  const activePath = getActiveWorkspace();
  if (!activePath) {
    const workspaces = getWorkspaces();
    if (workspaces.length === 0) {
      return state;
    }
    return pollForCwd(workspaces[0]!.path);
  }
  return pollForCwd(activePath);
}

async function pollForCwd(cwd: string): Promise<TrayState> {
  try {
    const [reviewPrs, authorPrs] = await Promise.all([
      listPrs(cwd, "reviewRequested"),
      listPrs(cwd, "authored"),
    ]);
    state = { reviewPrs, authorPrs, lastUpdated: new Date() };
  } catch (err) {
    // Don't break the tray if gh is unavailable, but log for debugging
    console.error("[tray-poller] poll failed:", (err as Error).message);
  }
  return state;
}

export function startPolling(onUpdate: (state: TrayState) => void, intervalMs = 60_000): void {
  pollOnce()
    .then(onUpdate)
    .catch(() => {});

  pollInterval = setInterval(() => {
    pollOnce()
      .then(onUpdate)
      .catch(() => {});
  }, intervalMs);
}

export function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
