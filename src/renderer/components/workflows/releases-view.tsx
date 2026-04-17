/* eslint-disable import/max-dependencies -- This screen intentionally composes release management controls. */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { toastManager } from "@/components/ui/toast";
import { GitHubAvatar } from "@/renderer/components/shared/github-avatar";
import { MarkdownBody } from "@/renderer/components/shared/markdown-body";
import { useKeyboardShortcuts } from "@/renderer/hooks/app/use-keyboard-shortcuts";
import { ipc } from "@/renderer/lib/app/ipc";
import { openExternal } from "@/renderer/lib/app/open-external";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { useKeybindings } from "@/renderer/lib/keyboard/keybinding-context";
import { handleSearchInputEscape } from "@/renderer/lib/keyboard/search-input";
import { relativeTime } from "@/shared/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Search, Tag } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Releases view — Phase 3 §3.4
 *
 * List releases, create new releases with changelog generation.
 */

export const RELEASES_QUERY_CACHE_MS = 30 * 60_000;

function getEmptyMessage(
  totalCount: number,
  searchQuery: string,
  showPrereleases: boolean,
): string {
  if (totalCount === 0) {
    return "No releases found";
  }
  if (searchQuery.trim()) {
    return "No releases match your search";
  }
  if (!showPrereleases) {
    return "No stable releases found";
  }
  return "No releases found";
}

function HighlightText({
  text,
  query,
  className,
}: {
  text: string;
  query: string;
  className?: string;
}) {
  const trimmed = query.trim();
  if (!trimmed) {
    return <span className={className}>{text}</span>;
  }
  const needle = trimmed.toLowerCase();
  const haystack = text.toLowerCase();
  const segments: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const hit = haystack.indexOf(needle, cursor);
    if (hit === -1) {
      segments.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (hit > cursor) {
      segments.push({ text: text.slice(cursor, hit), match: false });
    }
    segments.push({ text: text.slice(hit, hit + needle.length), match: true });
    cursor = hit + needle.length;
  }
  return (
    <span className={className}>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark
            // eslint-disable-next-line react/no-array-index-key -- stable within a single render
            key={index}
            className="bg-primary/35 text-text-primary rounded-[3px] px-0.5 font-medium"
          >
            {segment.text}
          </mark>
        ) : (
          // eslint-disable-next-line react/no-array-index-key -- stable within a single render
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  );
}

function makeBodySnippet(body: string, query: string, context = 60): string | null {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }
  const idx = body.toLowerCase().indexOf(trimmed.toLowerCase());
  if (idx === -1) {
    return null;
  }
  const start = Math.max(0, idx - context);
  const end = Math.min(body.length, idx + trimmed.length + context);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return prefix + body.slice(start, end).replaceAll(/\s+/g, " ").trim() + suffix;
}

export function ReleasesView() {
  const { repoTarget, nwo } = useWorkspace();
  const { getBinding } = useKeybindings();
  const [showPrereleases, setShowPrereleases] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const releasesQuery = useQuery({
    queryKey: ["releases", "list", nwo],
    queryFn: () => ipc("releases.list", { ...repoTarget }),
    gcTime: RELEASES_QUERY_CACHE_MS,
    staleTime: RELEASES_QUERY_CACHE_MS,
  });

  // Check if user has push permission (needed to create releases)
  const repoInfoQuery = useQuery({
    queryKey: ["repo", "info", nwo],
    queryFn: () => ipc("repo.info", { ...repoTarget }),
    staleTime: 300_000,
  });

  const allReleases = releasesQuery.data ?? [];
  const hasPrereleases = allReleases.some((release) => release.isPrerelease);
  const hasAnyReleases = allReleases.length > 0;
  const releases = useMemo(() => {
    const base = showPrereleases
      ? allReleases
      : allReleases.filter((release) => !release.isPrerelease);
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return base;
    }
    return base.filter((release) => {
      const haystack = [release.tagName, release.name, release.body, release.author.login]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [allReleases, showPrereleases, searchQuery]);
  const canCreateRelease = repoInfoQuery.data?.canPush ?? false;

  const clampedFocusIndex =
    releases.length === 0 ? -1 : Math.min(Math.max(focusIndex, -1), releases.length - 1);
  if (clampedFocusIndex !== focusIndex) {
    setFocusIndex(clampedFocusIndex);
  }

  useEffect(() => {
    if (clampedFocusIndex < 0) {
      return;
    }
    const node = itemRefs.current[clampedFocusIndex];
    if (!node) {
      return;
    }
    node.scrollIntoView({ block: "nearest" });
    if (document.activeElement !== node && document.activeElement !== searchRef.current) {
      node.focus({ preventScroll: true });
    }
  }, [clampedFocusIndex]);

  const openReleaseUrl = useCallback(
    (tagName: string) => {
      const url = `https://github.com/${repoTarget.owner}/${repoTarget.repo}/releases/tag/${encodeURIComponent(tagName)}`;
      void openExternal(url);
    },
    [repoTarget.owner, repoTarget.repo],
  );

  const focusNextRelease = useCallback(() => {
    setFocusIndex((index) => {
      if (releases.length === 0) {
        return -1;
      }
      return Math.min(index + 1, releases.length - 1);
    });
  }, [releases.length]);

  const focusPreviousRelease = useCallback(() => {
    setFocusIndex((index) => {
      if (releases.length === 0) {
        return -1;
      }
      return Math.max(index - 1, 0);
    });
  }, [releases.length]);

  const focusSearchBinding = getBinding("search.focusSearch");
  useKeyboardShortcuts([
    {
      ...focusSearchBinding,
      handler: () => searchRef.current?.focus(),
      preventWhileTyping: true,
    },
    { key: "ArrowDown", handler: focusNextRelease },
    { key: "ArrowUp", handler: focusPreviousRelease },
  ]);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-text-primary text-2xl italic">Releases</h1>
            <p className="text-text-secondary mt-1 text-sm">Manage releases for this repo.</p>
          </div>
          {canCreateRelease && <CreateReleaseDialog latestTag={allReleases[0]?.tagName} />}
        </div>

        {hasAnyReleases && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="border-border bg-bg-raised focus-within:border-primary flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2 py-1.5 transition-colors">
              <Search
                size={13}
                className="text-text-tertiary shrink-0"
              />
              <input
                ref={searchRef}
                aria-label="Search releases"
                autoComplete="off"
                name="release-search"
                spellCheck={false}
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setFocusIndex(-1);
                }}
                placeholder="Search releases…"
                className="text-text-primary placeholder:text-text-tertiary min-w-0 flex-1 bg-transparent text-xs focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" && releases.length > 0) {
                    e.preventDefault();
                    searchRef.current?.blur();
                    setFocusIndex(0);
                    return;
                  }
                  handleSearchInputEscape(e);
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Clear release search"
                  onClick={() => setSearchQuery("")}
                  className="text-text-tertiary hover:text-text-primary cursor-pointer text-[10px]"
                >
                  esc
                </button>
              )}
            </div>
            {hasPrereleases && (
              <div className="flex items-center gap-2">
                <label
                  htmlFor="show-prereleases-toggle"
                  className="text-text-secondary cursor-pointer text-xs"
                >
                  Show pre-releases
                </label>
                <Switch
                  id="show-prereleases-toggle"
                  checked={showPrereleases}
                  onCheckedChange={setShowPrereleases}
                  aria-label="Toggle pre-releases"
                  className="cursor-pointer"
                />
              </div>
            )}
          </div>
        )}

        {releasesQuery.isLoading && (
          <div className="flex items-center justify-center py-16">
            <Spinner className="text-primary h-5 w-5" />
          </div>
        )}

        {!releasesQuery.isLoading && releases.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16">
            <Tag
              size={24}
              className="text-text-ghost"
            />
            <p className="text-text-tertiary text-sm">
              {getEmptyMessage(allReleases.length, searchQuery, showPrereleases)}
            </p>
            {(searchQuery || !showPrereleases) && hasAnyReleases && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setShowPrereleases(true);
                }}
                className="text-primary hover:text-accent-hover mt-1 cursor-pointer text-xs"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3">
          {releases.map((release, index) => {
            const isFocused = index === clampedFocusIndex;
            return (
              <div
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                key={release.tagName}
                role="button"
                tabIndex={0}
                aria-label={`Open release ${release.name || release.tagName} on GitHub`}
                onClick={() => {
                  setFocusIndex(index);
                  openReleaseUrl(release.tagName);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openReleaseUrl(release.tagName);
                  }
                }}
                className={`bg-bg-raised hover:border-primary/50 focus-visible:border-primary cursor-pointer rounded-lg border p-4 transition-colors focus:outline-none ${
                  isFocused ? "border-primary shadow-sm" : "border-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Tag
                    size={14}
                    className="text-primary shrink-0"
                  />
                  <h3 className="text-text-primary text-sm font-semibold">
                    <HighlightText
                      text={release.name || release.tagName}
                      query={searchQuery}
                    />
                  </h3>
                  <Badge
                    variant="outline"
                    className="border-primary/30 text-primary font-mono text-[10px]"
                  >
                    <HighlightText
                      text={release.tagName}
                      query={searchQuery}
                    />
                  </Badge>
                  {release.isDraft && (
                    <Badge
                      variant="outline"
                      className="border-warning/30 text-warning text-[9px]"
                    >
                      Draft
                    </Badge>
                  )}
                  {release.isPrerelease && (
                    <Badge
                      variant="outline"
                      className="border-info/30 text-info text-[9px]"
                    >
                      Pre-release
                    </Badge>
                  )}
                </div>
                <div className="text-text-tertiary mt-1.5 flex items-center gap-1.5 text-xs">
                  <GitHubAvatar
                    login={release.author.login}
                    size={14}
                  />
                  <HighlightText
                    text={release.author.login}
                    query={searchQuery}
                  />
                  <span className="text-text-ghost">·</span>
                  <span>{relativeTime(new Date(release.createdAt))}</span>
                </div>
                {release.body &&
                  (() => {
                    const snippet = makeBodySnippet(release.body, searchQuery);
                    if (snippet) {
                      return (
                        <p className="text-text-secondary mt-3 text-xs leading-relaxed break-words">
                          <HighlightText
                            text={snippet}
                            query={searchQuery}
                          />
                        </p>
                      );
                    }
                    return (
                      <div className="mt-3">
                        <MarkdownBody
                          content={release.body}
                          className="text-xs"
                        />
                      </div>
                    );
                  })()}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create release dialog
// ---------------------------------------------------------------------------

function CreateReleaseDialog({ latestTag }: { latestTag?: string }) {
  const { repoTarget } = useWorkspace();
  const [tagName, setTagName] = useState("");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState("main");
  const [isDraft, setIsDraft] = useState(false);
  const [isPrerelease, setIsPrerelease] = useState(false);

  const changelogMutation = useMutation({
    mutationFn: (sinceTag: string) =>
      ipc("releases.generateChangelog", { ...repoTarget, sinceTag }),
    onSuccess: (changelog) => {
      setBody(changelog);
    },
    onError: () => {
      toastManager.add({ title: "Failed to generate changelog", type: "error" });
    },
  });

  const createMutation = useMutation({
    mutationFn: () =>
      ipc("releases.create", {
        ...repoTarget,
        tagName,
        name: name || tagName,
        body,
        isDraft,
        isPrerelease,
        target,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["releases"] });
      toastManager.add({ title: "Release created", description: result.url, type: "success" });
      setTagName("");
      setName("");
      setBody("");
    },
    onError: (err: Error) => {
      toastManager.add({
        title: "Failed to create release",
        description: err.message,
        type: "error",
      });
    },
  });

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            size="xs"
            className="bg-primary text-primary-foreground hover:bg-accent-hover gap-1.5"
          />
        }
      >
        <Plus size={14} />
        New Release
      </DialogTrigger>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Release</DialogTitle>
          <DialogDescription>Tag a new release with optional changelog.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-6 pb-4">
          <div className="flex gap-2">
            <input
              aria-label="Release tag name"
              autoComplete="off"
              name="release-tag-name"
              spellCheck={false}
              type="text"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              placeholder="Tag name (e.g. v1.2.0)"
              className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary flex-1 rounded-md border px-3 py-2 font-mono text-xs focus:outline-none"
            />
            <input
              aria-label="Release target branch"
              autoComplete="off"
              name="release-target-branch"
              spellCheck={false}
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="Target branch"
              className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary w-28 rounded-md border px-3 py-2 font-mono text-xs focus:outline-none"
            />
          </div>
          <input
            aria-label="Release name"
            autoComplete="off"
            name="release-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Release name (optional)"
            className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary rounded-md border px-3 py-2 text-xs focus:outline-none"
          />
          <div>
            <div className="flex items-center justify-between">
              <span className="text-text-tertiary text-[11px]">Release notes</span>
              {latestTag && (
                <button
                  type="button"
                  onClick={() => changelogMutation.mutate(latestTag)}
                  disabled={changelogMutation.isPending}
                  className="text-primary hover:text-accent-hover cursor-pointer text-[11px]"
                >
                  {changelogMutation.isPending ? "Generating…" : "Generate changelog"}
                </button>
              )}
            </div>
            <textarea
              aria-label="Release notes"
              autoComplete="off"
              value={body}
              name="release-notes"
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="Describe this release…"
              className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary mt-1 w-full resize-none rounded-md border px-3 py-2 font-mono text-xs leading-relaxed focus:outline-none"
            />
          </div>
          <div className="flex gap-4">
            <label className="text-text-secondary flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                name="release-draft"
                type="checkbox"
                checked={isDraft}
                onChange={(e) => setIsDraft(e.target.checked)}
                className="accent-primary"
              />
              Draft
            </label>
            <label className="text-text-secondary flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                name="release-prerelease"
                type="checkbox"
                checked={isPrerelease}
                onChange={(e) => setIsPrerelease(e.target.checked)}
                className="accent-primary"
              />
              Pre-release
            </label>
          </div>
        </div>
        <DialogFooter variant="bare">
          <DialogClose
            render={
              <Button
                size="xs"
                variant="ghost"
              />
            }
          >
            Cancel
          </DialogClose>
          <DialogClose
            render={
              <Button
                size="xs"
                className="bg-primary text-primary-foreground hover:bg-accent-hover"
                disabled={!tagName.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              />
            }
          >
            {createMutation.isPending ? <Spinner className="h-3 w-3" /> : "Create Release"}
          </DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
