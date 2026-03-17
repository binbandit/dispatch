import { Button } from "@/components/ui/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FolderOpen, GitBranch, Trash2 } from "lucide-react";

import { queryClient, trpc } from "../lib/trpc";

/**
 * Onboarding flow: shown when no workspaces are configured.
 *
 * The user adds local git repositories that Dispatch will watch.
 * Once at least one repo is added, they can proceed.
 */

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const workspacesQuery = useQuery(trpc.workspace.list.queryOptions());
  const workspaces = workspacesQuery.data ?? [];

  const addMutation = useMutation(
    trpc.workspace.add.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["workspace"] });
      },
    }),
  );

  const removeMutation = useMutation(
    trpc.workspace.remove.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["workspace"] });
      },
    }),
  );

  const setActiveMutation = useMutation(trpc.workspace.setActive.mutationOptions());

  const pickFolderMutation = useMutation(
    trpc.workspace.pickFolder.mutationOptions({
      onSuccess: (result) => {
        if (result) {
          addMutation.mutate({ path: result });
        }
      },
    }),
  );

  function handleContinue() {
    const firstWorkspace = workspaces[0];
    if (firstWorkspace) {
      setActiveMutation.mutate({ path: firstWorkspace.path }, { onSuccess: () => onComplete() });
    }
  }

  return (
    <div className="bg-bg-root flex h-screen flex-col items-center justify-center px-8">
      {/* Header */}
      <div className="flex flex-col items-center gap-3">
        {/* Logo mark */}
        <div
          className="bg-primary flex h-12 w-12 items-center justify-center rounded-lg"
          style={{ boxShadow: "0 0 30px rgba(212, 136, 58, 0.12)" }}
        >
          <span className="font-heading text-bg-root text-3xl leading-none italic">d</span>
        </div>

        <h1 className="font-heading text-text-primary text-4xl italic">Welcome to Dispatch</h1>
        <p className="text-text-secondary max-w-md text-center text-[13px] leading-relaxed">
          Add a local Git repository to get started. Dispatch will watch it for pull requests that
          need your attention.
        </p>
      </div>

      {/* Workspace list */}
      <div className="mt-8 w-full max-w-lg">
        {workspaces.length > 0 && (
          <div className="mb-4 flex flex-col gap-1.5">
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                className="border-border bg-bg-raised flex items-center gap-3 rounded-lg border px-4 py-3"
              >
                <GitBranch
                  size={16}
                  className="text-primary shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-text-primary text-sm font-medium">{ws.name}</p>
                  <p className="text-text-tertiary truncate font-mono text-[11px]">{ws.path}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeMutation.mutate({ id: ws.id })}
                  className="text-text-tertiary hover:bg-bg-elevated hover:text-destructive flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add repo button */}
        <Button
          variant="outline"
          className="w-full gap-2 border-dashed"
          onClick={() => pickFolderMutation.mutate({})}
          disabled={pickFolderMutation.isPending || addMutation.isPending}
        >
          <FolderOpen size={14} />
          {pickFolderMutation.isPending ? "Opening..." : "Add a repository"}
        </Button>

        {addMutation.isError && (
          <p className="text-destructive mt-2 text-xs">
            {String((addMutation.error as Error)?.message ?? "Not a valid git repository")}
          </p>
        )}
      </div>

      {/* Continue */}
      <div className="mt-8">
        <Button
          size="lg"
          className="bg-primary text-primary-foreground hover:bg-accent-hover gap-2 px-8"
          disabled={workspaces.length === 0}
          onClick={handleContinue}
        >
          Get started
        </Button>
      </div>

      <p className="text-text-tertiary mt-4 text-[11px]">
        You can always add more repositories later from settings.
      </p>
    </div>
  );
}
