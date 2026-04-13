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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { startTransition, useEffect, useMemo, useState } from "react";

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
  const [requestedAiTriageSnapshotKey, setRequestedAiTriageSnapshotKey] = useState<string | null>(
    null,
  );
  const aiTriageMutation = useMutation({
    mutationFn: async () => {
      if (!aiTriageInput || !aiTriageSnapshotKey) {
        throw new Error("Triage data is not ready yet.");
      }

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
        return null;
      }

      return ipc("ai.triage.set", {
        nwo,
        prNumber,
        snapshotKey: aiTriageSnapshotKey,
        payload: JSON.stringify(parsed),
      });
    },
    onSuccess: (entry) => {
      startTransition(() => {
        queryClient.setQueryData(aiTriageQueryKey, entry);
      });
    },
  });
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
      aiTriageMutation.isPending
    ) {
      return;
    }

    const needsGeneration = !activeAiTriage || aiTriageNeedsRefresh;
    if (!needsGeneration || requestedAiTriageSnapshotKey === aiTriageSnapshotKey) {
      return;
    }

    setRequestedAiTriageSnapshotKey(aiTriageSnapshotKey);
    aiTriageMutation.mutate();
  }, [
    aiTriageInput,
    aiTriageMutation,
    aiTriageNeedsRefresh,
    aiTriageQuery.isLoading,
    aiTriageSnapshotKey,
    config.isConfigured,
    files.length,
    hasAiCandidateFiles,
    isCommitView,
    activeAiTriage,
    pr,
    requestedAiTriageSnapshotKey,
    viewMode,
  ]);

  function refreshAiTriage() {
    if (!aiTriageInput || !aiTriageSnapshotKey || aiTriageMutation.isPending) {
      return;
    }

    setRequestedAiTriageSnapshotKey(aiTriageSnapshotKey);
    aiTriageMutation.mutate();
  }

  const meta =
    viewMode === "triage" && !isCommitView && config.isConfigured && files.length > 0 ? (
      <div className="border-border-subtle bg-bg-raised/70 flex items-center gap-1.5 rounded-md border px-2 py-1.5">
        <Sparkles
          size={11}
          className="text-accent-text shrink-0"
        />
        <span className="text-text-secondary min-w-0 flex-1 text-[10px] leading-none">
          {aiTriageMutation.isPending
            ? activeAiTriage
              ? "Refreshing AI grouping..."
              : "Generating AI grouping..."
            : hasAiCandidateFiles
              ? aiTriageNeedsRefresh
                ? "PR changed. Using stable triage until AI is refreshed."
                : activeAiTriage
                  ? "AI aligned files to the triage sections."
                  : aiTriageMutation.isError
                    ? "AI grouping failed. Using default buckets."
                    : "Using default buckets while AI grouping warms up."
              : "Using stable triage buckets for this PR."}
        </span>
        {(aiTriageNeedsRefresh || aiTriageMutation.isError) && !aiTriageMutation.isPending ? (
          <button
            type="button"
            onClick={refreshAiTriage}
            className="text-accent-text hover:text-text-primary shrink-0 cursor-pointer text-[10px] font-medium transition-colors"
          >
            {aiTriageMutation.isError ? "Retry" : "Refresh"}
          </button>
        ) : null}
      </div>
    ) : null;

  return { sections, meta };
}
