import type { GhPrDetail } from "@/shared/ipc";

import { useAiTaskConfig } from "@/renderer/hooks/ai/use-ai-task-config";
import { ipc } from "@/renderer/lib/app/ipc";
import { getDiffFilePath, type DiffFile } from "@/renderer/lib/review/diff-parser";
import {
  buildAiTriageSections,
  buildHeuristicTriageSections,
  getFallbackBucketForFile,
  type TriageGroup,
  type TriageSection,
} from "@/renderer/lib/review/triage-classifier";
import {
  buildAiTriagePrompt,
  buildAiTriageSnapshotKey,
  parseAiTriagePayload,
} from "@/shared/ai-triage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo } from "react";

type AiTriageRunStatus = "idle" | "running" | "error";

type AiTriageRunState = {
  status: AiTriageRunStatus;
  runId: number;
  startedAt: number;
  snapshotKey: string;
  errorMessage?: string;
};

export interface UseAiTriageSectionsArgs {
  nwo: string;
  prNumber: number;
  pr: GhPrDetail | undefined;
  files: DiffFile[];
  triageGroups: TriageGroup;
  fileCommentCounts: Map<string, number>;
  annotationPaths: Set<string>;
  viewedFiles: Set<string>;
  viewMode: "triage" | "tree";
  isCommitView: boolean;
}

interface UseAiTriageSectionsResult {
  sections: TriageSection[];
  meta: React.ReactNode;
}

function aiTriageRunStateQueryKey(nwo: string, prNumber: number) {
  return ["ai", "triage", "runState", nwo, prNumber] as const;
}

function startAiTriageGeneration({
  aiTriageInput,
  aiTriageSnapshotKey,
  nwo,
  prNumber,
  queryClient,
  runStateQueryKey,
  triageQueryKey,
  taskConfigured,
}: {
  aiTriageInput: {
    prNumber: number;
    prTitle: string;
    prBody: string;
    author: string;
    files: {
      path: string;
      status: string;
      additions: number;
      deletions: number;
      commentCount: number;
      hasAnnotation: boolean;
      fallbackBucket: string;
      note?: string;
    }[];
  };
  aiTriageSnapshotKey: string;
  nwo: string;
  prNumber: number;
  queryClient: ReturnType<typeof useQueryClient>;
  runStateQueryKey: readonly ["ai", "triage", "runState", string, number];
  triageQueryKey: readonly ["ai", "triage", string, number];
  taskConfigured: boolean;
}) {
  if (!taskConfigured) {
    return Promise.resolve();
  }

  const previousState = queryClient.getQueryData<AiTriageRunState>(runStateQueryKey);
  if (previousState?.status === "running" && previousState.snapshotKey === aiTriageSnapshotKey) {
    return Promise.resolve();
  }

  const runId = (previousState?.runId ?? 0) + 1;
  const runState: AiTriageRunState = {
    status: "running",
    runId,
    startedAt: Date.now(),
    snapshotKey: aiTriageSnapshotKey,
  };
  queryClient.setQueryData(runStateQueryKey, runState);

  const task = (async () => {
    try {
      const { systemPrompt, userPrompt } = buildAiTriagePrompt(aiTriageInput);
      const response = await ipc("ai.complete", {
        task: "triage",
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        maxTokens: 768,
      });
      const parsed = parseAiTriagePayload(response);
      if (!parsed) {
        throw new Error("AI triage output is invalid.");
      }

      const entry = await ipc("ai.triage.set", {
        nwo,
        prNumber,
        snapshotKey: aiTriageSnapshotKey,
        payload: JSON.stringify(parsed),
      });

      const currentState = queryClient.getQueryData<AiTriageRunState>(runStateQueryKey);
      if (
        currentState?.status === "running" &&
        currentState.runId === runId &&
        currentState.snapshotKey === aiTriageSnapshotKey
      ) {
        queryClient.setQueryData(triageQueryKey, entry);
        queryClient.setQueryData(runStateQueryKey, {
          ...runState,
          status: "idle",
          errorMessage: undefined,
          startedAt: Date.now(),
        });
      }
    } catch (error) {
      const currentState = queryClient.getQueryData<AiTriageRunState>(runStateQueryKey);
      if (
        currentState?.status === "running" &&
        currentState.runId === runId &&
        currentState.snapshotKey === aiTriageSnapshotKey
      ) {
        queryClient.setQueryData(runStateQueryKey, {
          ...runState,
          status: "error",
          errorMessage: error instanceof Error ? error.message : "Failed to generate AI triage.",
          startedAt: Date.now(),
        });
      }
    }
  })();

  return task;
}

export function useAiTriageSections({
  nwo,
  prNumber,
  pr,
  files,
  triageGroups,
  fileCommentCounts,
  annotationPaths,
  viewedFiles,
  viewMode,
  isCommitView,
}: UseAiTriageSectionsArgs): UseAiTriageSectionsResult {
  const config = useAiTaskConfig("triage");
  const queryClient = useQueryClient();

  const heuristicTriageSections = useMemo(
    () => buildHeuristicTriageSections(triageGroups),
    [triageGroups],
  );
  const triageAnnotationByPath = useMemo(
    () =>
      new Map(
        [...triageGroups.attention, ...triageGroups.changed, ...triageGroups.lowRisk].map(
          (entry) => [getDiffFilePath(entry.file), entry.annotation?.trim() ?? ""],
        ),
      ),
    [triageGroups],
  );
  const signals = useMemo(
    () => ({
      commentCounts: fileCommentCounts,
      annotationPaths,
      viewedFiles,
    }),
    [annotationPaths, fileCommentCounts, viewedFiles],
  );
  const aiTriageInput = useMemo(() => {
    if (!pr) {
      return null;
    }

    return {
      prNumber,
      prTitle: pr.title,
      prBody: pr.body,
      author: pr.author.login,
      files: files.map((file) => {
        const path = getDiffFilePath(file);
        const note = triageAnnotationByPath.get(path) ?? "";

        return {
          path,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          commentCount: fileCommentCounts.get(path) ?? 0,
          hasAnnotation: annotationPaths.has(path),
          fallbackBucket: getFallbackBucketForFile(path, signals),
          note: note.length > 0 ? note : undefined,
        };
      }),
    };
  }, [annotationPaths, fileCommentCounts, files, pr, prNumber, signals, triageAnnotationByPath]);
  const aiTriageSnapshotKey = useMemo(
    () => (aiTriageInput ? buildAiTriageSnapshotKey(aiTriageInput) : null),
    [aiTriageInput],
  );
  const hasAiCandidateFiles = Boolean(
    aiTriageInput?.files.some((file) => file.fallbackBucket === "changed"),
  );
  const aiTriageQueryKey = ["ai", "triage", nwo, prNumber] as const;
  const aiTriageQuery = useQuery({
    queryKey: aiTriageQueryKey,
    queryFn: () => ipc("ai.triage.get", { nwo, prNumber }),
    enabled:
      viewMode === "triage" &&
      !isCommitView &&
      config.isConfigured &&
      Boolean(pr) &&
      hasAiCandidateFiles,
    staleTime: 30_000,
  });
  const parsedAiTriage = useMemo(
    () => (aiTriageQuery.data?.payload ? parseAiTriagePayload(aiTriageQuery.data.payload) : null),
    [aiTriageQuery.data?.payload],
  );
  const triageRunStateQueryKey = aiTriageRunStateQueryKey(nwo, prNumber);
  const runState = useQuery({
    queryKey: triageRunStateQueryKey,
    queryFn: () =>
      queryClient.getQueryData<AiTriageRunState>(triageRunStateQueryKey) ?? {
        status: "idle",
        runId: 0,
        startedAt: Date.now(),
        snapshotKey: aiTriageSnapshotKey ?? "",
      },
    initialData: {
      status: "idle",
      runId: 0,
      startedAt: Date.now(),
      snapshotKey: aiTriageSnapshotKey ?? "",
    },
    enabled: config.isConfigured,
    gcTime: Number.POSITIVE_INFINITY,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const activeRunState =
    aiTriageSnapshotKey && runState.data.snapshotKey === aiTriageSnapshotKey ? runState.data : null;
  const isTriageRunning = activeRunState?.status === "running";
  const shouldShowTriageError = activeRunState?.status === "error";
  const aiTriageNeedsRefresh = Boolean(
    aiTriageSnapshotKey &&
    aiTriageQuery.data &&
    aiTriageQuery.data.snapshotKey !== aiTriageSnapshotKey,
  );
  const activeAiTriage = aiTriageNeedsRefresh ? null : parsedAiTriage;
  const sections = useMemo(() => {
    if (!activeAiTriage) {
      return heuristicTriageSections;
    }

    return buildAiTriageSections(triageGroups, activeAiTriage);
  }, [activeAiTriage, heuristicTriageSections, triageGroups]);

  const startAiTriageGenerationInBackground = () => {
    if (!aiTriageInput || !aiTriageSnapshotKey || isTriageRunning || !hasAiCandidateFiles) {
      return;
    }

    void startAiTriageGeneration({
      aiTriageInput,
      aiTriageSnapshotKey,
      nwo,
      prNumber,
      queryClient,
      runStateQueryKey: triageRunStateQueryKey,
      triageQueryKey: aiTriageQueryKey,
      taskConfigured: config.isConfigured,
    });
  };

  useEffect(() => {
    if (
      viewMode !== "triage" ||
      isCommitView ||
      !config.isConfigured ||
      !pr ||
      !aiTriageInput ||
      !aiTriageSnapshotKey ||
      !hasAiCandidateFiles ||
      files.length === 0 ||
      aiTriageQuery.isLoading ||
      isTriageRunning
    ) {
      return;
    }

    const needsGeneration = !activeAiTriage || aiTriageNeedsRefresh;
    if (!needsGeneration || runState.data.snapshotKey === aiTriageSnapshotKey) {
      return;
    }

    startAiTriageGenerationInBackground();
  }, [
    activeAiTriage,
    aiTriageInput,
    aiTriageNeedsRefresh,
    aiTriageQuery.isLoading,
    aiTriageSnapshotKey,
    config.isConfigured,
    files.length,
    hasAiCandidateFiles,
    isCommitView,
    isTriageRunning,
    runState.data.snapshotKey,
    viewMode,
  ]);

  const meta =
    viewMode === "triage" && !isCommitView && config.isConfigured && files.length > 0 ? (
      <div className="border-border-subtle bg-bg-raised/70 flex items-center gap-1.5 rounded-md border px-2 py-1.5">
        <Sparkles
          size={11}
          className="text-accent-text shrink-0"
        />
        <span className="text-text-secondary min-w-0 flex-1 text-[10px] leading-none">
          {isTriageRunning
            ? activeAiTriage
              ? "Refreshing AI grouping..."
              : "Generating AI grouping..."
            : hasAiCandidateFiles
              ? aiTriageNeedsRefresh
                ? "PR changed. Using stable triage until AI is refreshed."
                : activeAiTriage
                  ? shouldShowTriageError
                    ? "AI grouping failed on last run."
                    : "AI aligned files to the triage sections."
                  : shouldShowTriageError
                    ? "AI grouping failed. Using default buckets."
                    : "Using default buckets while AI grouping warms up."
              : "Using stable triage buckets for this PR."}
        </span>
        {!isTriageRunning && aiTriageInput && hasAiCandidateFiles ? (
          <button
            type="button"
            onClick={startAiTriageGenerationInBackground}
            className="text-accent-text hover:text-text-primary inline-flex shrink-0 cursor-pointer items-center gap-1 text-[10px] font-medium uppercase tracking-[0.04em] transition-colors"
          >
            <RefreshCw size={9} />
            {shouldShowTriageError ? "Retry" : "Refresh"}
          </button>
        ) : null}
      </div>
    ) : null;

  return { sections, meta };
}
