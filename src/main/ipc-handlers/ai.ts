import type { HandlerMap } from "./types";

import * as repo from "../db/repository";
import * as ai from "../services/ai";
import { getAiConfig } from "../services/ai-config";

export const aiHandlers: Pick<
  HandlerMap,
  | "ai.config"
  | "ai.providersStatus"
  | "ai.complete"
  | "ai.test"
  | "ai.reviewSummary.get"
  | "ai.reviewSummary.set"
  | "ai.triage.get"
  | "ai.triage.set"
> = {
  "ai.config": () => getAiConfig(),
  "ai.providersStatus": () => ai.getProvidersStatus(),
  "ai.complete": (args) => ai.complete(args),
  "ai.test": (args) => ai.testProvider(args),
  "ai.reviewSummary.get": (args) => repo.getAiReviewSummary(args.nwo, args.prNumber),
  "ai.reviewSummary.set": (args) =>
    repo.saveAiReviewSummary({
      workspace: args.nwo,
      prNumber: args.prNumber,
      snapshotKey: args.snapshotKey,
      summary: args.summary,
      confidenceScore: args.confidenceScore,
    }),
  "ai.triage.get": (args) => repo.getAiTriage(args.nwo, args.prNumber),
  "ai.triage.set": (args) =>
    repo.saveAiTriage({
      workspace: args.nwo,
      prNumber: args.prNumber,
      snapshotKey: args.snapshotKey,
      payload: args.payload,
    }),
};
