import type { Workspace } from "@/shared/ipc";

import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, FolderOpen, GitBranch, Globe, Lock, Search } from "lucide-react";
import { useCallback, useRef, useState } from "react";

interface AddRepoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded?: (workspace: Workspace) => void;
}

export function AddRepoDialog({ open, onOpenChange, onAdded }: AddRepoDialogProps) {
  const [query, setQuery] = useState("");
  const [addingRepo, setAddingRepo] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchQuery = useQuery({
    queryKey: ["workspace", "searchGitHub", query],
    queryFn: () => ipc("workspace.searchGitHub", { query, limit: 20 }),
    enabled: open,
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: (args: { owner: string; repo: string }) => {
      setAddingRepo(`${args.owner}/${args.repo}`);
      return ipc("workspace.add", args);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
      ipc("workspace.list").then((list) => {
        const added = list.find((w) => w.owner === variables.owner && w.repo === variables.repo);
        if (added) {
          onAdded?.(added);
        }
      });
      onOpenChange(false);
      setQuery("");
      setAddingRepo(null);
    },
    onError: () => {
      setAddingRepo(null);
    },
  });

  const addFromFolderMutation = useMutation({
    mutationFn: (args: { path: string }) => ipc("workspace.addFromFolder", args),
    onSuccess: (ws) => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
      ipc("workspace.list").then((list) => {
        const added = list.find((w) => w.owner === ws.owner && w.repo === ws.repo);
        if (added) {
          onAdded?.(added);
        }
      });
      onOpenChange(false);
      setQuery("");
    },
  });

  const pickFolderMutation = useMutation({
    mutationFn: () => ipc("workspace.pickFolder"),
    onSuccess: (result) => {
      if (result) {
        addFromFolderMutation.mutate({ path: result });
      }
    },
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
  const isPending = addMutation.isPending || addFromFolderMutation.isPending;
  const hasQuery = query.trim().length > 0;
  const showResults = hasQuery || results.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setQuery("");
          setAddingRepo(null);
        }
      }}
    >
      <DialogPopup
        className="max-w-[460px] overflow-hidden"
        showCloseButton={false}
      >
        {/* Header */}
        <DialogHeader className="pb-0">
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ background: "rgba(212, 136, 58, 0.10)" }}
            >
              <GitBranch
                size={15}
                className="text-primary"
              />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold">Add repository</DialogTitle>
              <DialogDescription className="text-text-tertiary mt-0.5 text-[12px]">
                Search GitHub or link a local clone
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Search */}
        <div className="px-6 pt-4 pb-0">
          <div
            className="border-border-strong bg-bg-root flex items-center gap-2.5 rounded-md border px-3 transition-colors focus-within:border-[rgba(212,136,58,0.35)]"
            style={{ height: 38 }}
          >
            {searchQuery.isFetching && hasQuery ? (
              <Spinner
                size={14}
                className="text-text-tertiary shrink-0"
              />
            ) : (
              <Search
                size={14}
                className="text-text-tertiary shrink-0"
              />
            )}
            <input
              type="text"
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder="Search your repositories…"
              className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-[13px] outline-none"
              disabled={isPending}
              autoFocus
            />
            {hasQuery && !isPending && (
              <button
                type="button"
                className="text-text-tertiary hover:text-text-secondary cursor-pointer text-[11px] transition-colors"
                onClick={() => {
                  setQuery("");
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Results area */}
        <div
          className="relative mt-2 overflow-y-auto px-3"
          style={{ maxHeight: 280, minHeight: showResults ? 80 : 0 }}
        >
          {/* Empty state */}
          {!searchQuery.isLoading && !showResults && (
            <div className="flex flex-col items-center justify-center py-8">
              <div
                className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: "rgba(212, 136, 58, 0.06)" }}
              >
                <Search
                  size={18}
                  className="text-text-tertiary"
                />
              </div>
              <p className="text-text-secondary text-[12px]">Start typing to find repositories</p>
            </div>
          )}

          {/* Loading skeleton */}
          {searchQuery.isLoading && hasQuery && results.length === 0 && (
            <div className="flex flex-col gap-1 py-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5"
                >
                  <div
                    className="bg-bg-raised h-4 w-4 animate-pulse rounded"
                    style={{ animationDelay: `${i * 80}ms` }}
                  />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div
                      className="bg-bg-raised h-3 animate-pulse rounded"
                      style={{ width: `${55 + i * 12}%`, animationDelay: `${i * 80}ms` }}
                    />
                    <div
                      className="bg-bg-raised h-2.5 animate-pulse rounded"
                      style={{ width: `${35 + i * 8}%`, animationDelay: `${i * 80 + 40}ms` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* No results */}
          {!searchQuery.isLoading && hasQuery && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8">
              <p className="text-text-secondary text-[12px]">No repositories matching "{query}"</p>
            </div>
          )}

          {/* Results list */}
          {results.length > 0 && (
            <div className="flex flex-col gap-0.5 py-1">
              {results.map((result) => {
                const isAdding = addingRepo === result.fullName;
                const [owner = "", name = ""] = result.fullName.split("/");

                return (
                  <button
                    key={result.fullName}
                    type="button"
                    disabled={isPending}
                    className="group hover:bg-bg-raised flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left transition-all disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => {
                      addMutation.mutate({ owner: result.owner, repo: result.repo });
                    }}
                  >
                    {/* Visibility icon */}
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-bg-raised/50">
                      {result.isPrivate ? (
                        <Lock
                          size={13}
                          className="text-text-tertiary"
                        />
                      ) : (
                        <Globe
                          size={13}
                          className="text-text-tertiary"
                        />
                      )}
                    </div>

                    {/* Repo info */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[12px] leading-tight">
                        <span className="text-text-secondary">{owner}</span>
                        <span className="text-text-tertiary">/</span>
                        <span className="text-text-primary font-medium">{name}</span>
                      </p>
                      {result.description && (
                        <p className="text-text-tertiary mt-0.5 truncate text-[11px] leading-tight">
                          {result.description}
                        </p>
                      )}
                    </div>

                    {/* Action indicator */}
                    <div className="flex shrink-0 items-center">
                      {isAdding ? (
                        <Spinner
                          size={13}
                          className="text-primary"
                        />
                      ) : (
                        <ArrowRight
                          size={13}
                          className="text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Bottom fade */}
          {results.length > 5 && (
            <div
              className="pointer-events-none sticky bottom-0 h-6"
              style={{
                background: "linear-gradient(to top, var(--popover), transparent)",
              }}
            />
          )}
        </div>

        {/* Divider + footer */}
        <div className="border-border mt-1 border-t">
          <div className="flex items-center justify-between px-6 py-3.5">
            <button
              type="button"
              className="text-text-tertiary hover:text-text-secondary flex cursor-pointer items-center gap-2 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => pickFolderMutation.mutate()}
              disabled={isPending || pickFolderMutation.isPending}
            >
              <FolderOpen size={13} />
              {pickFolderMutation.isPending || addFromFolderMutation.isPending
                ? "Linking..."
                : "Link local folder instead"}
            </button>

            {(addMutation.isError || addFromFolderMutation.isError) && (
              <p className="text-destructive max-w-[200px] truncate text-[11px]">
                {String(
                  ((addMutation.error ?? addFromFolderMutation.error) as Error)?.message ??
                    "Failed to add repository",
                )}
              </p>
            )}
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
