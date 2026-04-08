/* eslint-disable no-console -- Background tray polling failures should remain visible during local debugging. */
import type { GhPrListItemCore } from "../../shared/ipc";

import { getActiveWorkspace, getWorkspaces } from "../db/repository";
import { listPrsCore } from "./gh-cli";

/**
 * Background PR polling for the tray icon.
 *
 * Runs independently of the renderer — keeps updating even when
 * the window is closed/hidden. Polls the active workspace.
 */

export interface TrayState {
  reviewPrs: GhPrListItemCore[];
  authorPrs: GhPrListItemCore[];
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

export function pollOnce(): Promise<TrayState> {
  const activePath = getActiveWorkspace();
  if (!activePath) {
    const workspaces = getWorkspaces();
    const [firstWorkspace] = workspaces;
    if (!firstWorkspace) {
      return Promise.resolve(state);
    }
    return pollForCwd(firstWorkspace.path);
  }
  return pollForCwd(activePath);
}

async function pollForCwd(cwd: string): Promise<TrayState> {
  try {
    const [reviewPrs, authorPrs] = await Promise.all([
      listPrsCore(cwd, "reviewRequested"),
      listPrsCore(cwd, "authored"),
    ]);
    state = { reviewPrs, authorPrs, lastUpdated: new Date() };
  } catch (error) {
    // Don't break the tray if gh is unavailable, but log for debugging
    console.error("[tray-poller] poll failed:", (error as Error).message);
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
