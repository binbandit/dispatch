import type { HandlerMap } from "./types";

import { BrowserWindow, dialog } from "electron";

import * as repo from "../db/repository";
import * as ghCli from "../services/gh-cli";
import * as gitCli from "../services/git-cli";

type WorkspaceRecord = ReturnType<typeof repo.getWorkspaces>[number];

async function getResolvedWorkspaces(): Promise<WorkspaceRecord[]> {
  const workspaces = repo.getWorkspaces();

  // Lazy-resolve owner/repo from git remote for migrated workspaces with heuristic values.
  await Promise.all(
    workspaces.map(async (workspace) => {
      if (workspace.path && workspace.owner === "unknown") {
        try {
          const { owner, repo: repoName } = await ghCli.getOwnerRepo(workspace.path);
          repo.addWorkspace({
            owner,
            repo: repoName,
            path: workspace.path,
            name: workspace.name,
          });
          workspace.owner = owner;
          workspace.repo = repoName;
        } catch {
          // Git remote not available, keep heuristic values.
        }
      }
    }),
  );

  return workspaces;
}

async function getAccessibleWorkspaces(): Promise<WorkspaceRecord[]> {
  const workspaces = await getResolvedWorkspaces();
  if (workspaces.length === 0) {
    return [];
  }

  const results = await ghCli.mapWithConcurrency(
    workspaces,
    ghCli.MAX_CONCURRENT_GH_CALLS,
    async (workspace) => {
      await ghCli.getRepoInfo({
        cwd: workspace.path,
        owner: workspace.owner,
        repo: workspace.repo,
      });
      return workspace;
    },
  );

  return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

export const workspaceHandlers: Pick<
  HandlerMap,
  | "workspace.list"
  | "workspace.accessible"
  | "workspace.add"
  | "workspace.addFromFolder"
  | "workspace.remove"
  | "workspace.active"
  | "workspace.setActive"
  | "workspace.pickFolder"
  | "workspace.searchGitHub"
  | "workspace.checkPath"
  | "workspace.unlinkPath"
> = {
  "workspace.list": () => getResolvedWorkspaces(),
  "workspace.accessible": () => getAccessibleWorkspaces(),
  "workspace.add": (args) => {
    const name = args.name ?? args.repo;
    repo.addWorkspace({ owner: args.owner, repo: args.repo, path: args.path, name });
    return { owner: args.owner, repo: args.repo, path: args.path ?? null, name };
  },
  "workspace.addFromFolder": async (args) => {
    const root = await gitCli.getRepoRoot(args.path);
    if (!root) {
      throw new Error(`"${args.path}" is not inside a git repository.`);
    }
    const { owner, repo: repoName } = await ghCli.getOwnerRepo(root);
    const name = repoName;
    repo.addWorkspace({ owner, repo: repoName, path: root, name });
    return { owner, repo: repoName, path: root, name };
  },
  "workspace.remove": (args) => {
    repo.removeWorkspace(args.id);
  },
  "workspace.active": () => repo.getActiveWorkspace(),
  "workspace.setActive": async (args) => {
    repo.setActiveWorkspace(args.id);
    const ws = repo.getActiveWorkspace();
    if (!ws?.path) {
      return;
    }
    const saved = repo.getRepoAccount(ws.path);
    if (!saved) {
      return;
    }

    const accounts = await ghCli.listAccounts();
    const active = accounts.find((account) => account.active);
    if (!active || (active.host === saved.host && active.login === saved.login)) {
      return;
    }

    const stillValid = accounts.some(
      (account) => account.host === saved.host && account.login === saved.login,
    );
    if (stillValid) {
      await ghCli.switchAccount(saved.host, saved.login);
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
  "workspace.searchGitHub": (args) => ghCli.searchRepos(args.query, args.limit),
  "workspace.checkPath": (args) => repo.checkWorkspacePath(args.id),
  "workspace.unlinkPath": (args) => {
    repo.unlinkWorkspacePath(args.id);
  },
};
