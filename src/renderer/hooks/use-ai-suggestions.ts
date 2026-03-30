/**
 * useAiSuggestions — manages AI-generated code review suggestions.
 */

import type { AiSuggestion } from "../lib/ai-suggestions";
import type { DiffFile } from "../lib/diff-parser";

import { toastManager } from "@/components/ui/toast";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  buildSuggestionPrompt,
  collectValidLines,
  extractFileDiff,
  parseSuggestionsResponse,
} from "../lib/ai-suggestions";
import { getDiffFilePath } from "../lib/diff-parser";
import { ipc } from "../lib/ipc";
import { queryClient } from "../lib/query-client";
import { useWorkspace } from "../lib/workspace-context";
import { usePreference } from "./use-preference";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseAiSuggestionsOpts {
  prNumber: number;
  prTitle: string;
  prBody: string;
  files: DiffFile[];
  rawDiff: string | null;
  enabled: boolean;
}

export function useAiSuggestions({
  prNumber,
  prTitle,
  prBody,
  files,
  rawDiff,
  enabled,
}: UseAiSuggestionsOpts) {
  const { cwd } = useWorkspace();

  const [byFile, setByFile] = useState<Map<string, AiSuggestion[]>>(new Map());
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Refs for guards — keeps generateForFile identity stable
  const analyzedRef = useRef<Set<string>>(new Set());
  const generatingRef = useRef<Set<string>>(new Set());

  const autoSuggest = usePreference("aiAutoSuggest") === "true";

  // Reset state when PR changes
  const prevPrRef = useRef(prNumber);
  if (prevPrRef.current !== prNumber) {
    prevPrRef.current = prNumber;
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
      if (!enabled || !rawDiff) {
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
        const messages = buildSuggestionPrompt(prTitle, prBody, filePath, fileDiff);

        // Try ACP first, fall back to direct API
        let responseText: string;
        try {
          const result = await ipc("acp.complete", {
            cwd,
            text: messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"),
          });
          responseText = result.text;
        } catch {
          responseText = await ipc("ai.complete", {
            messages,
            maxTokens: 2048,
          });
        }

        const suggestions = parseSuggestionsResponse(responseText, filePath, validLines);
        analyzedRef.current.add(filePath);

        setByFile((prev) => {
          const next = new Map(prev);
          if (suggestions.length > 0) {
            next.set(filePath, suggestions);
          }
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        generatingRef.current.delete(filePath);
        setGenerating((prev) => {
          const next = new Set(prev);
          next.delete(filePath);
          return next;
        });
      }
    },
    [enabled, rawDiff, files, prTitle, prBody, cwd],
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
          cwd,
          prNumber,
          body: body ?? suggestion.body,
          path: suggestion.path,
          line: suggestion.line,
        });

        markAsPosted(suggestion.id, suggestion.path);
        void queryClient.invalidateQueries({ queryKey: ["pr", "comments"] });
        toastManager.add({ title: "Comment posted", type: "success" });
      } catch (err) {
        toastManager.add({
          title: "Failed to post comment",
          description: err instanceof Error ? err.message : String(err),
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
    (filePath: string): AiSuggestion[] => {
      return (byFile.get(filePath) ?? []).filter((s) => s.status === "pending");
    },
    [byFile],
  );

  const isGenerating = useCallback(
    (filePath: string): boolean => generating.has(filePath),
    [generating],
  );

  const totalCount = useMemo(
    () =>
      Array.from(byFile.values()).reduce(
        (sum, suggestions) => sum + suggestions.filter((s) => s.status === "pending").length,
        0,
      ),
    [byFile],
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
