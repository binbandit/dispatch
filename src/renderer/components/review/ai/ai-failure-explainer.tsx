import type { RepoTarget } from "@/shared/ipc";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAiTaskConfig } from "@/renderer/hooks/ai/use-ai-task-config";
import { ipc } from "@/renderer/lib/app/ipc";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles, XCircle } from "lucide-react";
import { useState } from "react";

interface AiFailureExplainerProps {
  checkName: string;
  repoTarget: RepoTarget;
  runId: number;
}

export function AiFailureExplainer({ checkName, repoTarget, runId }: AiFailureExplainerProps) {
  const config = useAiTaskConfig("failureExplanation");
  const [explanation, setExplanation] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const logQuery = useQuery({
    queryKey: ["checks", "logs", repoTarget.owner, repoTarget.repo, runId],
    queryFn: () => ipc("checks.logs", { ...repoTarget, runId }),
    staleTime: 60_000,
    enabled: false,
  });

  const explainMutation = useMutation({
    mutationFn: async () => {
      const logResult = await logQuery.refetch();
      const logText = logResult.data ?? "";
      const logTail = logText.split("\n").slice(-200).join("\n");

      return ipc("ai.complete", {
        cwd: repoTarget.cwd ?? undefined,
        task: "failureExplanation",
        messages: [
          {
            role: "system",
            content:
              "A CI/CD pipeline has failed. Explain the failure in plain English and suggest a fix. Be concise (3-4 sentences max).",
          },
          {
            role: "user",
            content: `Check name: ${checkName}\nStatus: Failed\n\nLog output (last 200 lines):\n${logTail}`,
          },
        ],
        maxTokens: 512,
      });
    },
    onSuccess: (text) => {
      setExplanation(text);
    },
  });

  if (!config.isConfigured || dismissed) {
    return null;
  }

  if (explanation) {
    return (
      <div className="border-primary/30 bg-bg-surface mt-2 rounded-md border p-3">
        <div className="flex items-center gap-1.5">
          <Sparkles
            size={12}
            className="text-primary"
          />
          <span className="text-primary text-[10px] font-medium">AI Explanation</span>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-text-ghost hover:text-text-primary ml-auto cursor-pointer"
          >
            <XCircle size={11} />
          </button>
        </div>
        <p className="text-text-secondary mt-1.5 text-xs leading-relaxed">{explanation}</p>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-primary hover:text-accent-hover mt-1 gap-1 px-0 text-[10px]"
      onClick={() => explainMutation.mutate()}
      disabled={explainMutation.isPending}
    >
      {explainMutation.isPending ? <Spinner className="h-3 w-3" /> : <Sparkles size={11} />}
      Explain failure with AI
    </Button>
  );
}
