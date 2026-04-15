import type { HandlerMap } from "./types";

import * as ghCli from "../services/gh-cli";

export const pullRequestHandlers: Pick<
  HandlerMap,
  | "pr.list"
  | "pr.listEnrichment"
  | "pr.detail"
  | "pr.commits"
  | "pr.diff"
  | "pr.updateTitle"
  | "pr.updateBody"
  | "pr.repoLabels"
  | "pr.addLabel"
  | "pr.removeLabel"
  | "pr.merge"
  | "pr.updateBranch"
  | "pr.close"
  | "pr.mergeQueueStatus"
  | "pr.comments"
  | "pr.replyToComment"
  | "pr.comment"
  | "pr.editIssueComment"
  | "pr.editReviewComment"
  | "pr.issueComments"
  | "pr.contributors"
  | "pr.searchUsers"
  | "pr.issuesList"
  | "pr.reviewRequests"
  | "pr.reviewThreads"
  | "pr.resolveThread"
  | "pr.unresolveThread"
  | "pr.createComment"
  | "pr.submitReview"
  | "pr.submitReviewWithComments"
  | "pr.reactions"
  | "pr.addReaction"
  | "pr.removeReaction"
  | "checks.list"
  | "checks.logs"
  | "checks.rerunFailed"
  | "checks.annotations"
  | "mergeQueue.list"
> = {
  "pr.list": (args) => ghCli.listPrsCore(args, args.filter, args.state, args.forceRefresh),
  "pr.listEnrichment": (args) =>
    ghCli.listPrsEnrichment(args, args.filter, args.state, args.forceRefresh),
  "pr.detail": (args) => ghCli.getPrDetail(args, args.prNumber),
  "pr.commits": (args) => ghCli.getPrCommits(args, args.prNumber),
  "pr.diff": (args) => ghCli.getPrDiff(args, args.prNumber),
  "pr.updateTitle": async (args) => {
    await ghCli.updatePrTitle(args, args.prNumber, args.title);
  },
  "pr.updateBody": async (args) => {
    await ghCli.updatePrBody(args, args.prNumber, args.body);
  },
  "pr.repoLabels": (args) => ghCli.listRepoLabels(args),
  "pr.addLabel": async (args) => {
    await ghCli.addPrLabel(args, args.prNumber, args.label);
  },
  "pr.removeLabel": async (args) => {
    await ghCli.removePrLabel(args, args.prNumber, args.label);
  },
  "pr.merge": (args) =>
    ghCli.mergePr(args, args.prNumber, args.strategy, args.admin, args.auto, args.hasMergeQueue),
  "pr.updateBranch": async (args) => {
    await ghCli.updatePrBranch(args, args.prNumber);
  },
  "pr.close": async (args) => {
    await ghCli.closePr(args, args.prNumber);
  },
  "pr.mergeQueueStatus": (args) => ghCli.getMergeQueueStatus(args, args.prNumber),
  "pr.comments": (args) => ghCli.getPrReviewComments(args, args.prNumber),
  "pr.replyToComment": async (args) => {
    await ghCli.replyToReviewComment(args, args.prNumber, args.commentId, args.body);
  },
  "pr.comment": async (args) => {
    await ghCli.createPrComment(args, args.prNumber, args.body);
  },
  "pr.editIssueComment": async (args) => {
    await ghCli.updateIssueComment(args, args.prNumber, args.commentId, args.body);
  },
  "pr.issueComments": (args) => ghCli.getIssueComments(args, args.prNumber),
  "pr.contributors": (args) => ghCli.getPrContributors(args, args.prNumber),
  "pr.searchUsers": (args) => ghCli.searchUsers(args, args.query),
  "pr.issuesList": (args) => ghCli.listIssuesAndPrs(args, args.limit),
  "pr.reviewRequests": (args) => ghCli.getPrReviewRequests(args, args.prNumber),
  "pr.reviewThreads": (args) => ghCli.getPrReviewThreads(args, args.prNumber),
  "pr.resolveThread": async (args) => {
    await ghCli.resolveReviewThread(args, args.threadId);
  },
  "pr.unresolveThread": async (args) => {
    await ghCli.unresolveReviewThread(args, args.threadId);
  },
  "pr.createComment": async (args) => {
    await ghCli.createReviewComment(args);
  },
  "pr.editReviewComment": async (args) => {
    await ghCli.updateReviewComment(args, args.prNumber, args.commentId, args.body);
  },
  "pr.submitReview": async (args) => {
    await ghCli.submitReview(args);
  },
  "pr.submitReviewWithComments": async (args) => {
    await ghCli.submitReviewWithComments(args);
  },
  "pr.reactions": (args) => ghCli.getPrReactions(args, args.prNumber),
  "pr.addReaction": async (args) => {
    await ghCli.addReaction(args, args.subjectId, args.content);
  },
  "pr.removeReaction": async (args) => {
    await ghCli.removeReaction(args, args.subjectId, args.content);
  },
  "checks.list": (args) => ghCli.getPrChecks(args, args.prNumber),
  "checks.logs": (args) => ghCli.getRunLogs(args, args.runId),
  "checks.rerunFailed": async (args) => {
    await ghCli.rerunFailedJobs(args, args.runId);
  },
  "checks.annotations": (args) => ghCli.getCheckAnnotations(args, args.prNumber),
  "mergeQueue.list": (args) => ghCli.listMergeQueueEntries(args),
};
