import { Button } from "@/components/ui/button";
import { GitHubRepoSearch } from "@/renderer/components/setup/onboarding-github-repo-search";
import { WorkspaceCard } from "@/renderer/components/setup/onboarding-workspace-card";
import { DispatchLogo } from "@/renderer/components/shared/dispatch-logo";
import { getErrorMessage } from "@/renderer/lib/app/error-message";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";

/**
 * Onboarding flow: shown when no workspaces are configured.
 *
 * Users can add repositories either by searching GitHub or linking a local folder.
 */

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const workspacesQuery = useQuery({
    queryKey: ["workspace", "list"],
    queryFn: () => ipc("workspace.list"),
  });
  const workspaces = workspacesQuery.data ?? [];

  const addMutation = useMutation({
    mutationFn: (args: { owner: string; repo: string; path?: string | null; name?: string }) =>
      ipc("workspace.add", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const addFromFolderMutation = useMutation({
    mutationFn: (args: { path: string }) => ipc("workspace.addFromFolder", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (args: { id: number }) => ipc("workspace.remove", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const setActiveMutation = useMutation({
    mutationFn: (args: { id: number }) => ipc("workspace.setActive", args),
  });

  const pickFolderMutation = useMutation({
    mutationFn: () => ipc("workspace.pickFolder"),
    onSuccess: (result) => {
      if (result) {
        addFromFolderMutation.mutate({ path: result });
      }
    },
  });

  function handleContinue() {
    const [firstWorkspace] = workspaces;
    if (firstWorkspace) {
      setActiveMutation.mutate({ id: firstWorkspace.id }, { onSuccess: () => onComplete() });
    }
  }

  return (
    <div className="bg-bg-root flex h-screen flex-col items-center justify-center px-8">
      {/* Header */}
      <div className="flex flex-col items-center gap-3">
        <div style={{ filter: "drop-shadow(0 0 30px rgba(212, 136, 58, 0.12))" }}>
          <DispatchLogo size={48} />
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <span className="font-heading text-accent-text text-[20px] leading-none tracking-[-0.02em] italic">
            Welcome to
          </span>
          <h1 className="text-text-primary text-[40px] leading-none font-semibold tracking-[-0.05em]">
            Dispatch
          </h1>
          <span
            className="h-px w-24"
            aria-hidden="true"
            style={{
              background:
                "linear-gradient(90deg, rgba(212, 136, 58, 0) 0%, rgba(212, 136, 58, 0.65) 50%, rgba(212, 136, 58, 0) 100%)",
            }}
          />
        </div>
        <p className="text-text-secondary max-w-md text-center text-[13px] leading-relaxed">
          Add a GitHub repository to get started. Dispatch will watch it for pull requests that need
          your attention.
        </p>
      </div>

      {/* Workspace list */}
      <div className="mt-8 w-full max-w-lg">
        {workspaces.length > 0 && (
          <div className="mb-4 flex flex-col gap-1.5">
            {workspaces.map((ws) => (
              <WorkspaceCard
                key={ws.id}
                workspace={ws}
                onRemove={() => removeMutation.mutate({ id: ws.id })}
              />
            ))}
          </div>
        )}

        {/* Add repo buttons */}
        <div className="flex flex-col gap-2">
          <GitHubRepoSearch
            onSelect={(result) => {
              addMutation.mutate({
                owner: result.owner,
                repo: result.repo,
                name: result.repo,
              });
            }}
            isPending={addMutation.isPending}
          />

          <Button
            size="xs"
            variant="outline"
            className="w-full gap-2"
            onClick={() => pickFolderMutation.mutate()}
            disabled={pickFolderMutation.isPending || addFromFolderMutation.isPending}
          >
            <FolderOpen size={14} />
            {pickFolderMutation.isPending ? "Opening…" : "Link local folder"}
          </Button>
        </div>

        {(addMutation.isError || addFromFolderMutation.isError || pickFolderMutation.isError) && (
          <p className="text-destructive mt-2 text-xs">
            {addMutation.isError
              ? getErrorMessage(addMutation.error)
              : addFromFolderMutation.isError
                ? getErrorMessage(addFromFolderMutation.error)
                : "Failed to open folder picker"}
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
