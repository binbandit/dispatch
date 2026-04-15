import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Circle } from "lucide-react";
import { useState } from "react";

export function ThreadResolveButton({
  threadId,
  initialResolved = false,
}: {
  threadId: string;
  initialResolved?: boolean;
}) {
  const { repoTarget } = useWorkspace();
  const [resolved, setResolved] = useState(initialResolved);

  const resolveMutation = useMutation({
    mutationFn: () =>
      resolved
        ? ipc("pr.unresolveThread", { ...repoTarget, threadId })
        : ipc("pr.resolveThread", { ...repoTarget, threadId }),
    onSuccess: () => {
      setResolved((currentResolved) => !currentResolved);
      queryClient.invalidateQueries({ queryKey: ["pr", "comments"] });
      queryClient.invalidateQueries({ queryKey: ["pr", "reviewThreads"] });
    },
    onError: () => {
      toastManager.add({ title: "Failed to update thread", type: "error" });
    },
  });

  return (
    <Button
      size="sm"
      variant="ghost"
      className={cn(
        "h-6 gap-1 rounded-md border px-2 shadow-none",
        resolved
          ? "text-success border-[rgba(61,214,140,0.22)] bg-[rgba(61,214,140,0.08)] hover:bg-[rgba(61,214,140,0.12)]"
          : "border-border-subtle bg-bg-root/60 text-text-tertiary hover:border-border hover:bg-bg-raised hover:text-text-primary",
      )}
      onClick={() => resolveMutation.mutate()}
      disabled={resolveMutation.isPending}
    >
      {resolveMutation.isPending ? (
        <Spinner className="h-3 w-3" />
      ) : resolved ? (
        <CheckCircle2
          size={11}
          className="text-success"
        />
      ) : (
        <Circle size={11} />
      )}
      {resolved ? "Resolved" : "Resolve"}
    </Button>
  );
}
