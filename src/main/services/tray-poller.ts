/* eslint-disable no-console -- Background tray polling failures should remain visible during local debugging. */
import type { GhPrListItemCore, RepoTarget } from "../../shared/ipc";

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
  const activeWs = getActiveWorkspace();
  if (activeWs) {
    return pollForTarget({ cwd: activeWs.path, owner: activeWs.owner, repo: activeWs.repo });
  }
  const workspaces = getWorkspaces();
  const [firstWorkspace] = workspaces;
  if (!firstWorkspace) {
    return Promise.resolve(state);
  }
  return pollForTarget({
    cwd: firstWorkspace.path,
    owner: firstWorkspace.owner,
    repo: firstWorkspace.repo,
  });
}

async function pollForTarget(target: RepoTarget): Promise<TrayState> {
  try {
    const [reviewPrs, authorPrs] = await Promise.all([
      listPrsCore(target, "reviewRequested"),
      listPrsCore(target, "authored"),
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
