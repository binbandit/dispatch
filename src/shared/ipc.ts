import type {
  AiIpcApi,
  AppIpcApi,
  EnvironmentIpcApi,
  GitIpcApi,
  InsightsIpcApi,
  NotificationIpcApi,
  PullRequestIpcApi,
  ReviewStateIpcApi,
  WorkflowIpcApi,
} from "./ipc/contracts";

/**
 * Typed IPC API contract between main and renderer processes.
 *
 * Every IPC call goes through a single channel "dispatch:ipc".
 * The payload is { method: string, args: unknown }.
 * The response is { ok: true, data: T } | { ok: false, error: string }.
 */

export const IPC_CHANNEL = "dispatch:ipc";
export const WINDOW_STATE_CHANNEL = "window-state";
export const BADGE_COUNT_CHANNEL = "set-badge-count";
export const ANALYTICS_CHANNEL = "analytics:track";
export const AI_REWRITE_SELECTION_CHANNEL = "ai:rewrite-selection";

export interface WindowState {
  isFullscreen: boolean;
}

// ---------------------------------------------------------------------------
// Service types shared across processes
// ---------------------------------------------------------------------------

export type AiProvider = "codex" | "claude" | "copilot" | "ollama" | "opencode";
export type AiConfigSource = "preference" | "environment" | "default" | "none";
export type AiModelSlot = "big" | "small";
export type AiTaskId =
  | "codeExplanation"
  | "commentRewrite"
  | "failureExplanation"
  | "reviewSummary"
  | "reviewConfidence"
  | "triage"
  | "commentSuggestions";

export interface AiProviderResolvedConfig {
  provider: AiProvider;
  model: string | null;
  suggestedModels?: string[];
  binaryPath: string | null;
  homePath: string | null;
  baseUrl: string | null;
  isConfigured: boolean;
  modelSource: AiConfigSource;
  binaryPathSource: AiConfigSource;
  homePathSource: AiConfigSource;
  baseUrlSource: AiConfigSource;
  modelEnvVar: string | null;
  binaryPathEnvVar: string | null;
  homePathEnvVar: string | null;
  baseUrlEnvVar: string | null;
}

export interface AiSlotResolvedConfig {
  slot: AiModelSlot;
  provider: AiProvider | null;
  model: string | null;
  binaryPath: string | null;
  homePath: string | null;
  baseUrl: string | null;
  isConfigured: boolean;
  providerSource: AiConfigSource;
  modelSource: AiConfigSource;
  binaryPathSource: AiConfigSource;
  homePathSource: AiConfigSource;
  baseUrlSource: AiConfigSource;
  providerEnvVar: string | null;
  modelEnvVar: string | null;
  binaryPathEnvVar: string | null;
  homePathEnvVar: string | null;
  baseUrlEnvVar: string | null;
}

export interface AiTaskResolvedConfig extends AiSlotResolvedConfig {
  task: AiTaskId;
  selectedSlot: AiModelSlot;
  selectedSlotSource: AiConfigSource;
}

export interface AiResolvedConfig {
  isConfigured: boolean;
  providers: Record<AiProvider, AiProviderResolvedConfig>;
  slots: Record<AiModelSlot, AiSlotResolvedConfig>;
  tasks: Record<AiTaskId, AiTaskResolvedConfig>;
}

export interface AiProviderStatus {
  provider: AiProvider;
  version: string | null;
  available: boolean;
  authenticated: boolean | null;
  statusText: string;
}

export interface AiReviewSummaryCacheEntry {
  summary: string;
  confidenceScore: number | null;
  snapshotKey: string;
  generatedAt: string;
}

export interface AiTriageCacheEntry {
  payload: string;
  snapshotKey: string;
  generatedAt: string;
}

export interface GhPrListItem {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  author: { login: string; name?: string | null };
  headRefName: string;
  baseRefName: string;
  reviewDecision: string;
  statusCheckRollup: Array<{
    name: string;
    status: string;
    conclusion: string | null;
  }>;
  updatedAt: string;
  url: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
  mergeable: string;
  autoMergeRequest: {
    enabledBy: { login: string };
    mergeMethod: string;
  } | null;
}

/** Lightweight version returned by the core list query (no heavy fields). */
export type GhPrListItemCore = Omit<
  GhPrListItem,
  "statusCheckRollup" | "mergeable" | "autoMergeRequest"
>;

/** Enrichment payload keyed by PR number. */
export interface GhPrEnrichment {
  number: number;
  statusCheckRollup: GhPrListItem["statusCheckRollup"];
  additions: number;
  deletions: number;
  mergeable: string;
  autoMergeRequest: {
    enabledBy: { login: string };
    mergeMethod: string;
  } | null;
}

export interface GhPrDetail {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  body: string;
  author: { login: string; name?: string | null };
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  reviewDecision: string;
  mergeable: string;
  statusCheckRollup: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    detailsUrl: string;
  }>;
  reviews: Array<{
    author: { login: string };
    state: string;
    submittedAt: string;
  }>;
  files: Array<{
    path: string;
    additions: number;
    deletions: number;
  }>;
  labels: Array<{ name: string; color: string }>;
  autoMergeRequest: {
    enabledBy: { login: string };
    mergeMethod: string;
  } | null;
  mergeStateStatus: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  url: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
}

export interface PrActivityState {
  repo: string;
  prNumber: number;
  lastSeenUpdatedAt: string;
  seenAt: string;
}

export interface GhCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string;
  startedAt: string;
  completedAt: string | null;
}

export interface GhReviewComment {
  id: number;
  body: string;
  path: string;
  line: number | null;
  original_line: number | null;
  side: "LEFT" | "RIGHT";
  user: { login: string; avatar_url: string };
  created_at: string;
  updated_at: string;
  in_reply_to_id?: number;
  /** GraphQL node ID for this review comment. Used for reactions. */
  node_id?: string;
}

export interface GhReviewRequest {
  login: string | null;
  name: string;
  type: "User" | "Team" | "Bot" | "Mannequin";
  asCodeOwner: boolean;
}

export interface GhReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  rootCommentId: number | null;
  comments: Array<{
    author: { login: string };
    body: string;
  }>;
}

export interface GhReactionActor {
  login: string;
  avatarUrl?: string | null;
}

export type GhReactionContent =
  | "THUMBS_UP"
  | "THUMBS_DOWN"
  | "LAUGH"
  | "HOORAY"
  | "CONFUSED"
  | "HEART"
  | "ROCKET"
  | "EYES";

export interface GhReactionGroup {
  content: GhReactionContent;
  count: number;
  viewerHasReacted: boolean;
  reactors: GhReactionActor[];
}

export interface GhPrReactions {
  prNodeId: string;
  prBody: GhReactionGroup[];
  /** Keyed by issue comment node_id (GraphQL ID from `gh pr view --json comments`) */
  issueComments: Record<string, GhReactionGroup[]>;
  /** Keyed by review comment databaseId (numeric `id` from REST API, as string) */
  reviewComments: Record<string, GhReactionGroup[]>;
}

export interface GhAnnotation {
  path: string;
  startLine: number;
  endLine: number;
  level: "notice" | "warning" | "failure";
  message: string;
  title: string;
  checkName: string;
}

export interface GhWorkflow {
  id: number;
  name: string;
  state: "active" | "disabled_manually" | "disabled_inactivity";
}

export interface GhWorkflowRun {
  databaseId: number;
  displayTitle: string;
  name: string;
  status: string;
  conclusion: string | null;
  headBranch: string;
  createdAt: string;
  updatedAt: string;
  event: string;
  workflowName: string;
  attempt: number;
}

export interface GhWorkflowRunJob {
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string;
  completedAt: string | null;
  steps: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    number: number;
  }>;
}

export interface GhWorkflowRunDetail extends GhWorkflowRun {
  headSha: string;
  workflowDatabaseId: number;
  jobs: GhWorkflowRunJob[];
}

export interface GhWorkflowJobGraphNode {
  id: string;
  needs: string[];
}

export interface GhWorkflowJobGraph {
  jobs: GhWorkflowJobGraphNode[];
}

export interface BlameLine {
  sha: string;
  author: string;
  date: string;
  summary: string;
}

export interface LogEntry {
  sha: string;
  author: string;
  date: string;
  message: string;
}

export type MergeStrategy = "merge" | "squash" | "rebase";

export interface RepoTarget {
  cwd: string | null;
  owner: string;
  repo: string;
}

export interface Workspace {
  id: number;
  owner: string;
  repo: string;
  path: string | null;
  name: string;
  addedAt: string;
}

export interface GhUser {
  login: string;
  avatarUrl: string;
  name: string | null;
}

export interface GhRepoContributionHistory {
  repo: string;
  pullRequests: number;
  mergedPullRequests: number;
  issues: number;
  reviewedPullRequests: number;
  total: number;
}

export interface GhUserProfile {
  login: string;
  name: string | null;
  avatarUrl: string;
  bio: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  following: number;
  publicRepos: number;
  createdAt: string;
  organizations: Array<{ login: string; avatarUrl: string }>;
  repoContributions: GhRepoContributionHistory | null;
}

export interface GhAccount {
  login: string;
  host: string;
  active: boolean;
  scopes: string;
  gitProtocol: string;
}

export interface GhRepoAccount {
  login: string;
  host: string;
}

export interface GhAvatarLookup {
  login: string;
  host: string;
  avatarUrl: string | null;
}

export interface RepoInfo {
  nameWithOwner: string;
  isFork: boolean;
  // "owner/name" of upstream repo, or null
  parent: string | null;
  canPush: boolean;
  hasMergeQueue: boolean;
}

export interface EnvStatus {
  ghVersion: string | null;
  gitVersion: string | null;
  ghAuth: boolean;
}

export interface DevRepoStatus {
  enabled: boolean;
  hasUpdates: boolean;
  currentBranch: string | null;
  upstreamBranch: string | null;
  aheadCount: number;
  behindCount: number;
}

// ---------------------------------------------------------------------------
// IPC Method Map
// ---------------------------------------------------------------------------

export interface IpcApi
  extends
    AppIpcApi,
    EnvironmentIpcApi,
    PullRequestIpcApi,
    GitIpcApi,
    WorkflowIpcApi,
    ReviewStateIpcApi,
    InsightsIpcApi,
    AiIpcApi,
    NotificationIpcApi {}

export type IpcMethod = keyof IpcApi;
