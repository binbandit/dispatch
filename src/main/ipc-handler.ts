import { BrowserWindow, dialog, ipcMain } from "electron";

import { IPC_CHANNEL, type IpcApi, type IpcMethod } from "../shared/ipc";
import * as repo from "./db/repository";
import * as ai from "./services/ai";
import { getAiConfig } from "./services/ai-config";
import { openExternalUrl } from "./services/external-links";
import * as ghCli from "./services/gh-cli";
import * as gitCli from "./services/git-cli";
import { showDesktopNotification } from "./services/notifications";
import { whichVersion } from "./services/shell";

/**
 * Direct IPC handler — maps method names to service calls.
 * No proxy magic, no framework. Just a switch statement.
 */

type Handler<M extends IpcMethod> = (args: IpcApi[M]["args"]) => Promise<IpcApi[M]["result"]>;

const handlers: { [M in IpcMethod]: Handler<M> } = {
  // Preferences
  "preferences.get": async (args) => repo.getPreference(args.key),
  "preferences.set": async (args) => {
    repo.setPreference(args.key, args.value);
  },
  "preferences.getAll": async (args) => {
    const result: Record<string, string | null> = {};
    for (const key of args.keys) {
      result[key] = repo.getPreference(key);
    }
    return result;
  },
  "app.openExternal": async (args) => {
    await openExternalUrl(args.url);
  },
  "app.devRepoStatus": async () => {
    if (!process.env.VITE_DEV_SERVER_URL) {
      return {
        enabled: false,
        hasUpdates: false,
        currentBranch: null,
        upstreamBranch: null,
        aheadCount: 0,
        behindCount: 0,
      };
    }

    const repoRoot = await gitCli.getRepoRoot(process.cwd());
    if (!repoRoot) {
      return {
        enabled: false,
        hasUpdates: false,
        currentBranch: null,
        upstreamBranch: null,
        aheadCount: 0,
        behindCount: 0,
      };
    }

    return gitCli.getDevRepoStatus(repoRoot);
  },

  // Environment
  "env.check": async () => {
    const [ghVersion, gitVersion] = await Promise.all([whichVersion("gh"), whichVersion("git")]);
    let ghAuth = false;
    if (ghVersion) {
      ghAuth = await ghCli.isGhAuthenticated();
    }
    return { ghVersion, gitVersion, ghAuth };
  },
  "env.user": async () => ghCli.getAuthenticatedUser(),
  "env.repoAccount": async (args) => {
    const saved = repo.getRepoAccount(args.cwd);
    if (saved) {
      return saved;
    }

    const accounts = await ghCli.listAccounts();

    // Determine the host from the repo's git remote so we pick the right account
    // even when the active account is on a different host.
    const repoHost = await ghCli.getRepoHost(args.cwd);
    if (repoHost) {
      const match = accounts.find((a) => a.host === repoHost);
      if (match) {
        return { host: match.host, login: match.login };
      }
    }

    const active = accounts.find((account) => account.active);
    if (!active) {
      return null;
    }

    return { host: active.host, login: active.login };
  },

  "repo.info": async (args) => ghCli.getRepoInfo(args.cwd),
  "env.accounts": async () => ghCli.listAccounts(),
  "env.switchAccount": async (args) => {
    await ghCli.switchAccount(args.host, args.login);
    // Remember this account for the active workspace
    const activeWs = repo.getActiveWorkspace();
    if (activeWs) {
      repo.setRepoAccount(activeWs, args.host, args.login);
    }
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
    // Auto-switch to the last-used GitHub account for this repo
    const saved = repo.getRepoAccount(args.path);
    if (saved) {
      const accounts = await ghCli.listAccounts();
      const active = accounts.find((a) => a.active);
      if (active && (active.host !== saved.host || active.login !== saved.login)) {
        // Only switch if the saved account is still authenticated
        const stillValid = accounts.some((a) => a.host === saved.host && a.login === saved.login);
        if (stillValid) {
          await ghCli.switchAccount(saved.host, saved.login);
        }
      }
    }
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
  "pr.list": async (args) => ghCli.listPrsCore(args.cwd, args.filter),
  "pr.listEnrichment": async (args) => ghCli.listPrsEnrichment(args.cwd, args.filter),
  "pr.detail": async (args) => ghCli.getPrDetail(args.cwd, args.prNumber),
  "pr.commits": async (args) => ghCli.getPrCommits(args.cwd, args.prNumber),
  "pr.diff": async (args) => ghCli.getPrDiff(args.cwd, args.prNumber),
  "pr.updateTitle": async (args) => {
    await ghCli.updatePrTitle(args.cwd, args.prNumber, args.title);
  },
  "pr.repoLabels": async (args) => ghCli.listRepoLabels(args.cwd),
  "pr.addLabel": async (args) => {
    await ghCli.addPrLabel(args.cwd, args.prNumber, args.label);
  },
  "pr.removeLabel": async (args) => {
    await ghCli.removePrLabel(args.cwd, args.prNumber, args.label);
  },
  "pr.merge": async (args) => {
    return ghCli.mergePr(args.cwd, args.prNumber, args.strategy, args.admin);
  },
  "pr.updateBranch": async (args) => {
    await ghCli.updatePrBranch(args.cwd, args.prNumber);
  },
  "pr.close": async (args) => {
    await ghCli.closePr(args.cwd, args.prNumber);
  },
  "pr.mergeQueueStatus": async (args) => ghCli.getMergeQueueStatus(args.cwd, args.prNumber),
  "pr.comments": async (args) => ghCli.getPrReviewComments(args.cwd, args.prNumber),
  "pr.replyToComment": async (args) => {
    await ghCli.replyToReviewComment(args.cwd, args.prNumber, args.commentId, args.body);
  },
  "pr.comment": async (args) => {
    await ghCli.createPrComment(args.cwd, args.prNumber, args.body);
  },
  "pr.issueComments": async (args) => ghCli.getIssueComments(args.cwd, args.prNumber),
  "pr.contributors": async (args) => ghCli.getPrContributors(args.cwd, args.prNumber),
  "pr.searchUsers": async (args) => ghCli.searchUsers(args.cwd, args.query),
  "pr.issuesList": async (args) => ghCli.listIssuesAndPrs(args.cwd, args.limit),
  "pr.resolveThread": async (args) => {
    await ghCli.resolveReviewThread(args.cwd, args.threadId);
  },
  "pr.unresolveThread": async (args) => {
    await ghCli.unresolveReviewThread(args.cwd, args.threadId);
  },
  "pr.createComment": async (args) => {
    await ghCli.createReviewComment(args);
  },
  "pr.submitReview": async (args) => {
    await ghCli.submitReview(args);
  },

  // Checks
  "checks.list": async (args) => ghCli.getPrChecks(args.cwd, args.prNumber),
  "checks.logs": async (args) => ghCli.getRunLogs(args.cwd, args.runId),
  "checks.rerunFailed": async (args) => {
    await ghCli.rerunFailedJobs(args.cwd, args.runId);
  },
  "checks.annotations": async (args) => ghCli.getCheckAnnotations(args.cwd, args.prNumber),

  // Git
  "git.blame": async (args) => gitCli.blame(args),
  "git.fileHistory": async (args) => gitCli.fileHistory(args.cwd, args.filePath, args.limit),
  "git.diff": async (args) => gitCli.diff(args.cwd, args.fromRef, args.toRef),
  "git.showFile": async (args) => gitCli.showFile(args.cwd, args.ref, args.filePath),
  "git.repoRoot": async (args) => gitCli.getRepoRoot(args.cwd),

  // Workflows
  "workflows.list": async (args) => ghCli.listWorkflows(args.cwd),
  "workflows.runs": async (args) => ghCli.listWorkflowRuns(args.cwd, args.workflowId, args.limit),
  "workflows.runDetail": async (args) => ghCli.getWorkflowRunDetail(args.cwd, args.runId),
  "workflows.trigger": async (args) => {
    await ghCli.triggerWorkflow(args);
  },
  "workflows.cancel": async (args) => {
    await ghCli.cancelWorkflowRun(args.cwd, args.runId);
  },
  "workflows.rerunAll": async (args) => {
    await ghCli.rerunWorkflowRun(args.cwd, args.runId);
  },
  "workflows.yaml": async (args) => ghCli.getWorkflowYaml(args.cwd, args.workflowId),

  // Review state
  "review.getLastSha": async (args) => repo.getLastReviewedSha(args.repo, args.prNumber),
  "review.saveSha": async (args) => {
    repo.saveReviewedSha(args.repo, args.prNumber, args.sha);
  },
  "review.viewedFiles": async (args) => repo.getViewedFiles(args.repo, args.prNumber),
  "review.setFileViewed": async (args) => {
    repo.setFileViewed(args.repo, args.prNumber, args.filePath, args.viewed);
  },
  "prActivity.list": () => Promise.resolve(repo.getPrActivityStates()),
  "prActivity.markSeen": (args) =>
    Promise.resolve(repo.markPrActivitySeen(args.repo, args.prNumber, args.updatedAt)),

  // Minimized comments
  "comment.getMinimized": async (args) => repo.getMinimizedComments(args.repo, args.prNumber),
  "comment.setMinimized": async (args) => {
    repo.setCommentMinimized(args.repo, args.prNumber, args.commentId, args.minimized);
  },

  // Multi-repo (3.1)
  "pr.listAll": async (args) => {
    const workspaces = repo.getWorkspaces();
    return ghCli.listAllPrs(workspaces, args.filter);
  },
  "pr.listAllEnrichment": async (args) => {
    const workspaces = repo.getWorkspaces();
    return ghCli.listAllPrsEnrichment(workspaces, args.filter);
  },

  // Metrics (3.2)
  "metrics.prCycleTime": async (args) => ghCli.getPrCycleTime(args.cwd, args.since),
  "metrics.reviewLoad": async (args) => ghCli.getReviewLoad(args.cwd, args.since),

  // AI (3.3)
  "ai.config": async () => getAiConfig(),
  "ai.complete": async (args) => ai.complete(args),

  // Releases (3.4)
  "releases.list": async (args) => ghCli.listReleases(args.cwd, args.limit),
  "releases.create": async (args) => ghCli.createRelease(args),
  "releases.generateChangelog": async (args) => ghCli.generateChangelog(args.cwd, args.sinceTag),

  // Notifications (3.5)
  "notifications.list": async (args) => repo.getNotifications(args.limit),
  "notifications.markRead": async (args) => {
    repo.markNotificationRead(args.id);
  },
  "notifications.markAllRead": async () => {
    repo.markAllNotificationsRead();
  },
  "notifications.insert": async (args) => {
    repo.insertNotification(args);
  },
  "notifications.show": async (args) => {
    repo.insertNotification(args);
    showDesktopNotification(args);
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
