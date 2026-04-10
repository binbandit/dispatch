import type { HandlerMap } from "./types";

import { BrowserWindow, app } from "electron";

import { destroyDatabase } from "../db/database";
import * as repo from "../db/repository";
import { openExternalUrl } from "../services/external-links";
import * as gitCli from "../services/git-cli";

const disabledDevRepoStatus = {
  enabled: false,
  hasUpdates: false,
  currentBranch: null,
  upstreamBranch: null,
  aheadCount: 0,
  behindCount: 0,
} as const;

export const appHandlers: Pick<
  HandlerMap,
  | "preferences.get"
  | "preferences.set"
  | "preferences.getAll"
  | "preferences.deleteMany"
  | "app.openExternal"
  | "app.nuke"
  | "app.setTrafficLightPosition"
  | "app.devRepoStatus"
> = {
  "preferences.get": (args) => repo.getPreference(args.key),
  "preferences.set": (args) => {
    repo.setPreference(args.key, args.value);
  },
  "preferences.getAll": (args) => {
    const result: Record<string, string | null> = {};
    for (const key of args.keys) {
      result[key] = repo.getPreference(key);
    }
    return result;
  },
  "preferences.deleteMany": (args) => {
    repo.deletePreferences(args.keys);
  },
  "app.openExternal": async (args) => {
    await openExternalUrl(args.url);
  },
  "app.nuke": () => {
    destroyDatabase();
    app.relaunch();
    app.exit(0);
  },
  "app.setTrafficLightPosition": (args) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (win) {
      win.setWindowButtonPosition({ x: args.x, y: args.y });
    }
  },
  "app.devRepoStatus": async (args) => {
    if (!process.env.VITE_DEV_SERVER_URL) {
      return disabledDevRepoStatus;
    }

    const cwd = args.cwd ?? process.cwd();
    const repoRoot = await gitCli.getRepoRoot(cwd);
    if (!repoRoot) {
      return disabledDevRepoStatus;
    }

    return gitCli.getDevRepoStatus(repoRoot);
  },
};
