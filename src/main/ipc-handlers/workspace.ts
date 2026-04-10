import type { HandlerMap } from "./types";

import { BrowserWindow, dialog } from "electron";

import * as repo from "../db/repository";
import * as ghCli from "../services/gh-cli";
import * as gitCli from "../services/git-cli";

export const workspaceHandlers: Pick<
  HandlerMap,
  | "workspace.list"
  | "workspace.add"
  | "workspace.addFromFolder"
  | "workspace.remove"
  | "workspace.active"
  | "workspace.setActive"
  | "workspace.pickFolder"
  | "workspace.searchGitHub"
> = {
  "workspace.list": async () => {
    const workspaces = repo.getWorkspaces();
    // Lazy-resolve owner/repo from git remote for migrated workspaces with heuristic values
    for (const ws of workspaces) {
      if (ws.path && ws.owner === "unknown") {
        try {
          const { owner, repo: repoName } = await ghCli.getOwnerRepo(ws.path);
          repo.addWorkspace({ owner, repo: repoName, path: ws.path, name: ws.name });
          ws.owner = owner;
          ws.repo = repoName;
        } catch {
          // Git remote not available, keep heuristic values
        }
      }
    }
    return workspaces;
  },
  "workspace.add": async (args) => {
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
};
