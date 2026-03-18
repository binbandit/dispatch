import type { IpcApi, IpcMethod } from "../shared/ipc";

import { BrowserWindow, dialog, ipcMain } from "electron";

import { IPC_CHANNEL } from "../shared/ipc";
import * as repo from "./db/repository";
import * as ghCli from "./services/gh-cli";
import * as gitCli from "./services/git-cli";
import { whichVersion } from "./services/shell";

/**
 * Direct IPC handler — maps method names to service calls.
 * No proxy magic, no framework. Just a switch statement.
 */

type Handler<M extends IpcMethod> = (args: IpcApi[M]["args"]) => Promise<IpcApi[M]["result"]>;

const handlers: { [M in IpcMethod]: Handler<M> } = {
  // Environment
  "env.check": async () => {
    const [ghVersion, gitVersion] = await Promise.all([whichVersion("gh"), whichVersion("git")]);
    let ghAuth = false;
    if (ghVersion) {
      ghAuth = await ghCli.isGhAuthenticated();
    }
    return { ghVersion, gitVersion, ghAuth };
  },

  // Workspace
  "workspace.list": async () => repo.getWorkspaces(),
  "workspace.add": async (args) => {
    const root = await gitCli.getRepoRoot(args.path);
    if (!root) {
      throw new Error(`"${args.path}" is not inside a git repository.`);
    }
    const name = root.split("/").pop() ?? root;
    repo.addWorkspace(root, name);
    return { path: root, name };
  },
  "workspace.remove": async (args) => {
    repo.removeWorkspace(args.id);
  },
  "workspace.active": async () => repo.getActiveWorkspace(),
  "workspace.setActive": async (args) => {
    repo.setActiveWorkspace(args.path);
  },
  "workspace.pickFolder": async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0] ?? null;
  },

  // PR
  "pr.list": async (args) => ghCli.listPrs(args.cwd, args.filter),
  "pr.detail": async (args) => ghCli.getPrDetail(args.cwd, args.prNumber),
  "pr.diff": async (args) => ghCli.getPrDiff(args.cwd, args.prNumber),
  "pr.merge": async (args) => {
    await ghCli.mergePr(args.cwd, args.prNumber, args.strategy);
  },
  "pr.comments": async (args) => ghCli.getPrReviewComments(args.cwd, args.prNumber),
  "pr.createComment": async (args) => {
    await ghCli.createReviewComment(args.cwd, args.prNumber, args.body, args.path, args.line);
  },
  "pr.submitReview": async (args) => {
    await ghCli.submitReview(args.cwd, args.prNumber, args.event, args.body);
  },

  // Checks
  "checks.list": async (args) => ghCli.getPrChecks(args.cwd, args.prNumber),
  "checks.logs": async (args) => ghCli.getRunLogs(args.cwd, args.runId),
  "checks.rerunFailed": async (args) => {
    await ghCli.rerunFailedJobs(args.cwd, args.runId);
  },
  "checks.annotations": async (args) => ghCli.getCheckAnnotations(args.cwd, args.prNumber),

  // Git
  "git.blame": async (args) => gitCli.blame(args.cwd, args.file, args.line, args.ref),
  "git.fileHistory": async (args) => gitCli.fileHistory(args.cwd, args.filePath, args.limit),
  "git.diff": async (args) => gitCli.diff(args.cwd, args.fromRef, args.toRef),
  "git.repoRoot": async (args) => gitCli.getRepoRoot(args.cwd),

  // Review state
  "review.getLastSha": async (args) => repo.getLastReviewedSha(args.repo, args.prNumber),
  "review.saveSha": async (args) => {
    repo.saveReviewedSha(args.repo, args.prNumber, args.sha);
  },
  "review.viewedFiles": async (args) => repo.getViewedFiles(args.repo, args.prNumber),
  "review.setFileViewed": async (args) => {
    repo.setFileViewed(args.repo, args.prNumber, args.filePath, args.viewed);
  },
};

/**
 * Register the IPC handler. Call once on app startup.
 */
export function registerIpcHandler(): void {
  ipcMain.handle(IPC_CHANNEL, async (_event, payload: { method: string; args: unknown }) => {
    const { method, args } = payload;
    const handler = handlers[method as IpcMethod];

    if (!handler) {
      return { ok: false, error: `Unknown method: ${method}` };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (handler as any)(args);
      return { ok: true, data: result ?? null };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[IPC] ${method} failed:`, error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
