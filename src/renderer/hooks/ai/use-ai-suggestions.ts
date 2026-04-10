/**
 * UseAiSuggestions manages AI-generated code review suggestions.
 */

import type { GhReviewComment } from "@/shared/ipc";

import { toastManager } from "@/components/ui/toast";
import { useAiTaskConfig } from "@/renderer/hooks/ai/use-ai-task-config";
import { usePreference } from "@/renderer/hooks/preferences/use-preference";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import {
  type AiSuggestion,
  appendAiReviewMarker,
  buildAiSuggestionsSnapshotKey,
  buildExistingCommentFingerprints,
  buildSuggestionPrompt,
  collectValidLines,
  extractFileDiff,
  isSuggestionDuplicate,
  parseSuggestionsResponse,
} from "@/renderer/lib/review/ai-suggestions";
import { getDiffFilePath, type DiffFile } from "@/renderer/lib/review/diff-parser";
import { useCallback, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseAiSuggestionsOpts {
  prNumber: number;
  prTitle: string;
  prBody: string;
  files: DiffFile[];
  rawDiff: string | null;
  existingComments: ReadonlyArray<GhReviewComment>;
  enabled: boolean;
}

export function useAiSuggestions({
  prNumber,
  prTitle,
  prBody,
  files,
  rawDiff,
  existingComments,
  enabled,
}: UseAiSuggestionsOpts) {
  const { cwd, repoTarget } = useWorkspace();
  const config = useAiTaskConfig("commentSuggestions");
  const snapshotKey = useMemo(
    () => buildAiSuggestionsSnapshotKey(prNumber, rawDiff),
    [prNumber, rawDiff],
  );

  const [byFile, setByFile] = useState<Map<string, AiSuggestion[]>>(new Map());
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Refs for guards — keeps generateForFile identity stable
  const analyzedRef = useRef<Set<string>>(new Set());
  const generatingRef = useRef<Set<string>>(new Set());

  const autoSuggest = usePreference("aiAutoSuggest") === "true";
  const existingCommentFingerprints = useMemo(
    () => buildExistingCommentFingerprints(existingComments),
    [existingComments],
  );

  // Reset state when the diff snapshot changes
  const prevSnapshotRef = useRef(snapshotKey);
  if (prevSnapshotRef.current !== snapshotKey) {
    prevSnapshotRef.current = snapshotKey;
    setByFile(new Map());
    setGenerating(new Set());
    setError(null);
    analyzedRef.current = new Set();
    generatingRef.current = new Set();
  }

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  const markAsPosted = useCallback((suggestionId: string, path: string) => {
    setByFile((prev) => {
      const next = new Map(prev);
      const fileSuggestions = next.get(path);
      if (fileSuggestions) {
        next.set(
          path,
          fileSuggestions.map((s) =>
            s.id === suggestionId ? { ...s, status: "posted" as const } : s,
          ),
        );
      }
      return next;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Generation (no `generating` state in deps — uses ref for guard)
  // -------------------------------------------------------------------------

  const generateForFile = useCallback(
    async (filePath: string) => {
      if (!enabled || !rawDiff || !config.isConfigured) {
        return;
      }
      if (analyzedRef.current.has(filePath) || generatingRef.current.has(filePath)) {
        return;
      }

      const diffFile = files.find((f) => getDiffFilePath(f) === filePath);
      if (!diffFile || diffFile.hunks.length === 0) {
        return;
      }

      const fileDiff = extractFileDiff(rawDiff, filePath);
      if (!fileDiff) {
        return;
      }

      const validLines = collectValidLines(diffFile.hunks);

      generatingRef.current.add(filePath);
      setGenerating((prev) => new Set(prev).add(filePath));
      setError(null);

      try {
        const messages = buildSuggestionPrompt(
          prTitle,
          prBody,
          filePath,
          fileDiff,
          files.map((file) => ({
            path: getDiffFilePath(file),
            additions: file.additions,
            deletions: file.deletions,
          })),
          existingComments
            .filter((comment) => comment.path === filePath)
            .map((comment) => ({
              line: comment.line,
              body: comment.body,
            })),
        );

        const responseText = await ipc("ai.complete", {
          cwd: cwd ?? undefined,
          task: "commentSuggestions",
          messages,
          maxTokens: 2048,
        });

        const suggestions = parseSuggestionsResponse(
          responseText,
          filePath,
          validLines,
          existingComments.filter((comment) => comment.path === filePath),
        );
        analyzedRef.current.add(filePath);

        setByFile((prev) => {
          const next = new Map(prev);
          if (suggestions.length > 0) {
            next.set(filePath, suggestions);
          }
          return next;
        });
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
      } finally {
        generatingRef.current.delete(filePath);
        setGenerating((prev) => {
          const next = new Set(prev);
          next.delete(filePath);
          return next;
        });
      }
    },
    [config.isConfigured, enabled, rawDiff, files, prTitle, prBody, cwd, existingComments],
  );

  // -------------------------------------------------------------------------
  // Auto-trigger on file navigation
  // -------------------------------------------------------------------------

  const autoTriggerFile = useCallback(
    (filePath: string): (() => void) => {
      if (!enabled || !autoSuggest || analyzedRef.current.has(filePath)) {
        return () => {};
      }
      const timer = setTimeout(() => {
        void generateForFile(filePath);
      }, 800);
      return () => clearTimeout(timer);
    },
    [enabled, autoSuggest, generateForFile],
  );

  // -------------------------------------------------------------------------
  // Post comment (unified for direct post and edit-then-post)
  // -------------------------------------------------------------------------

  const postComment = useCallback(
    async (suggestion: AiSuggestion, body?: string) => {
      try {
        await ipc("pr.createComment", {
          ...repoTarget,
          prNumber,
          body: appendAiReviewMarker(suggestion.path, body ?? suggestion.body),
          path: suggestion.path,
          line: suggestion.line,
        });

        markAsPosted(suggestion.id, suggestion.path);
        void queryClient.invalidateQueries({ queryKey: ["pr", "comments"] });
        toastManager.add({ title: "Comment posted", type: "success" });
      } catch (error) {
        toastManager.add({
          title: "Failed to post comment",
          description: error instanceof Error ? error.message : String(error),
          type: "foreground",
        });
      }
    },
    [cwd, prNumber, markAsPosted],
  );

  const dismiss = useCallback((id: string) => {
    setByFile((prev) => {
      const next = new Map(prev);
      for (const [path, suggestions] of next) {
        const filtered = suggestions.filter((s) => s.id !== id);
        if (filtered.length === 0) {
          next.delete(path);
        } else {
          next.set(path, filtered);
        }
      }
      return next;
    });
  }, []);

  const dismissFile = useCallback((filePath: string) => {
    setByFile((prev) => {
      const next = new Map(prev);
      next.delete(filePath);
      return next;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Accessors (memoized)
  // -------------------------------------------------------------------------

  const suggestionsForFile = useCallback(
    (filePath: string): AiSuggestion[] =>
      (byFile.get(filePath) ?? []).filter(
        (suggestion) =>
          suggestion.status === "pending" &&
          !isSuggestionDuplicate(suggestion, existingCommentFingerprints),
      ),
    [byFile, existingCommentFingerprints],
  );

  const isGenerating = useCallback(
    (filePath: string): boolean => generating.has(filePath),
    [generating],
  );

  const totalCount = useMemo(
    () =>
      [...byFile.values()].reduce(
        (sum, suggestions) =>
          sum +
          suggestions.filter(
            (suggestion) =>
              suggestion.status === "pending" &&
              !isSuggestionDuplicate(suggestion, existingCommentFingerprints),
          ).length,
        0,
      ),
    [byFile, existingCommentFingerprints],
  );

  return {
    suggestionsForFile,
    isGenerating,
    totalCount,
    hasSuggestions: totalCount > 0,
    generateForFile,
    autoTriggerFile,
    postComment,
    dismiss,
    dismissFile,
    error,
  };
}
