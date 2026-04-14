import type {
  EnvStatus,
  GhAccount,
  GhAvatarLookup,
  GhRepoAccount,
  GhUser,
  GhUserProfile,
  RepoInfo,
  RepoTarget,
  Workspace,
} from "../../ipc";

export interface GhRepoSearchResult {
  owner: string;
  repo: string;
  fullName: string;
  description: string | null;
  isPrivate: boolean;
}

export interface EnvironmentIpcApi {
  "env.check": { args: void; result: EnvStatus };
  "env.user": { args: void; result: GhUser | null };
  "env.accounts": { args: void; result: GhAccount[] };
  "env.repoAccount": { args: RepoTarget; result: GhRepoAccount | null };
  "env.avatarUrl": {
    args: { cwd: string | null; login: string; host: string };
    result: GhAvatarLookup | null;
  };
  "env.switchAccount": { args: { host: string; login: string }; result: void };
  "env.userProfile": { args: { login: string }; result: GhUserProfile };

  "repo.info": { args: RepoTarget; result: RepoInfo };

  "workspace.list": { args: void; result: Workspace[] };
  "workspace.add": {
    args: { owner: string; repo: string; path?: string | null; name?: string };
    result: { owner: string; repo: string; path: string | null; name: string };
  };
  "workspace.addFromFolder": {
    args: { path: string };
    result: { owner: string; repo: string; path: string; name: string };
  };
  "workspace.remove": { args: { id: number }; result: void };
  "workspace.active": {
    args: void;
    result: { id: number; owner: string; repo: string; path: string | null; name: string } | null;
  };
  "workspace.setActive": { args: { id: number }; result: void };
  "workspace.pickFolder": { args: void; result: string | null };
  "workspace.searchGitHub": {
    args: { query: string; limit?: number };
    result: GhRepoSearchResult[];
  };
  "workspace.checkPath": {
    args: { id: number };
    result: boolean;
  };
  "workspace.unlinkPath": {
    args: { id: number };
    result: void;
  };
}
