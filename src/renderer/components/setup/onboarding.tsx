import type { Workspace } from "@/shared/ipc";
import type { GhRepoSearchResult } from "@/shared/ipc/contracts/environment";

import { Button } from "@/components/ui/button";
import { DispatchLogo } from "@/renderer/components/shared/dispatch-logo";
import { getErrorMessage } from "@/renderer/lib/app/error-message";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FolderOpen, GitBranch, Globe, Lock, Search, Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";

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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WorkspaceCard({ workspace, onRemove }: { workspace: Workspace; onRemove: () => void }) {
  return (
    <div className="border-border bg-bg-raised flex items-center gap-3 rounded-lg border px-4 py-3">
      <GitBranch
        size={16}
        className="text-primary shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-text-primary text-sm font-medium">
          {workspace.owner}/{workspace.repo}
        </p>
        {workspace.path ? (
          <p className="text-text-tertiary truncate font-mono text-[11px]">{workspace.path}</p>
        ) : (
          <p className="text-text-ghost text-[11px]">Remote only</p>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="text-text-tertiary hover:bg-bg-elevated hover:text-destructive flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GitHub repo search
// ---------------------------------------------------------------------------

function GitHubRepoSearch({
  onSelect,
  isPending,
}: {
  onSelect: (result: GhRepoSearchResult) => void;
  isPending: boolean;
}) {
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const searchQuery = useQuery({
    queryKey: ["workspace", "searchGitHub", query],
    queryFn: () => ipc("workspace.searchGitHub", { query, limit: 15 }),
    enabled: showResults,
    staleTime: 30_000,
  });

  const handleInputChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      queryClient.invalidateQueries({
        queryKey: ["workspace", "searchGitHub", value],
      });
    }, 300);
  }, []);

  const results = searchQuery.data ?? [];

  return (
    <div
      ref={containerRef}
      className="relative"
    >
      <div className="border-border bg-bg-surface flex items-center gap-2 rounded-lg border px-3 py-2.5">
        <Search
          size={14}
          className="text-text-tertiary shrink-0"
        />
        <input
          aria-label="Search GitHub repositories"
          autoComplete="off"
          name="github-repository-search"
          spellCheck={false}
          type="search"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => setShowResults(true)}
          onBlur={() => {
            // Delay to allow click on results
            setTimeout(() => setShowResults(false), 200);
          }}
          placeholder="Search your GitHub repositories…"
          className="text-text-primary placeholder:text-text-ghost min-w-0 flex-1 bg-transparent text-sm outline-none"
          disabled={isPending}
        />
      </div>

      {/* Results dropdown */}
      {showResults && (
        <div className="border-border bg-bg-surface absolute top-full right-0 left-0 z-50 mt-1 max-h-[280px] overflow-y-auto rounded-lg border shadow-lg">
          {searchQuery.isLoading && (
            <div className="text-text-tertiary px-3 py-4 text-center text-xs">Searching…</div>
          )}
          {!searchQuery.isLoading && results.length === 0 && (
            <div className="text-text-tertiary px-3 py-4 text-center text-xs">
              {query ? "No repositories found" : "Type to search or see your repos"}
            </div>
          )}
          {results.map((result) => (
            <button
              key={result.fullName}
              type="button"
              className="hover:bg-bg-raised flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left transition-colors"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(result);
                setQuery("");
                setShowResults(false);
              }}
            >
              {result.isPrivate ? (
                <Lock
                  size={12}
                  className="text-text-tertiary shrink-0"
                />
              ) : (
                <Globe
                  size={12}
                  className="text-text-tertiary shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-text-primary truncate font-mono text-[12px] font-medium">
                  {result.fullName}
                </p>
                {result.description && (
                  <p className="text-text-tertiary mt-0.5 truncate text-[11px]">
                    {result.description}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
