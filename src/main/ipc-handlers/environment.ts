import type { HandlerMap } from "./types";

import * as repo from "../db/repository";
import * as ghCli from "../services/gh-cli";
import { whichVersion } from "../services/shell";

export const environmentHandlers: Pick<
  HandlerMap,
  | "env.check"
  | "env.user"
  | "env.userProfile"
  | "env.avatarUrl"
  | "env.repoAccount"
  | "repo.info"
  | "env.accounts"
  | "env.switchAccount"
> = {
  "env.check": async () => {
    const [ghVersion, gitVersion] = await Promise.all([whichVersion("gh"), whichVersion("git")]);
    let ghAuth = false;
    if (ghVersion) {
      ghAuth = await ghCli.isGhAuthenticated();
    }
    return { ghVersion, gitVersion, ghAuth };
  },
  "env.user": () => ghCli.getAuthenticatedUser(),
  "env.userProfile": (args) =>
    ghCli.getUserProfile(args.login, args.repoTarget ?? args.repo, args.currentPrNumber),
  "env.avatarUrl": (args) => ghCli.getAvatarUrl(args.cwd, args.login, args.host),
  "env.repoAccount": async (args) => {
    if (args.cwd) {
      const saved = repo.getRepoAccount(args.cwd);
      if (saved) {
        return saved;
      }
    }

    const accounts = await ghCli.listAccounts();
    const repoHost = await ghCli.getRepoHost(args);
    if (repoHost) {
      const match = accounts.find((account) => account.host === repoHost);
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
  "repo.info": (args) => ghCli.getRepoInfo(args),
  "env.accounts": () => ghCli.listAccounts(),
  "env.switchAccount": async (args) => {
    await ghCli.switchAccount(args.host, args.login);
    const activeWorkspace = repo.getActiveWorkspace();
    if (activeWorkspace?.path) {
      repo.setRepoAccount(activeWorkspace.path, args.host, args.login);
    }
  },
};
