import type { GhRepoSearchResult } from "@/shared/ipc/contracts/environment";

import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { handleSearchInputEscape } from "@/renderer/lib/keyboard/search-input";
import { useQuery } from "@tanstack/react-query";
import { Globe, Lock, Search } from "lucide-react";
import { useCallback, useRef, useState } from "react";

interface GitHubRepoSearchProps {
  onSelect: (result: GhRepoSearchResult) => void;
  isPending: boolean;
}

export function GitHubRepoSearch({ onSelect, isPending }: GitHubRepoSearchProps) {
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
            // Delay to allow click on results.
            setTimeout(() => setShowResults(false), 200);
          }}
          onKeyDown={(event) => {
            handleSearchInputEscape(event, { onEscape: () => setShowResults(false) });
          }}
          placeholder="Search your GitHub repositories…"
          className="text-text-primary placeholder:text-text-ghost min-w-0 flex-1 bg-transparent text-sm outline-none"
          disabled={isPending}
        />
      </div>

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
