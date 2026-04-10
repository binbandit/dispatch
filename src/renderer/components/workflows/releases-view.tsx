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
import { toastManager } from "@/components/ui/toast";
import { GitHubAvatar } from "@/renderer/components/shared/github-avatar";
import { MarkdownBody } from "@/renderer/components/shared/markdown-body";
import { ipc } from "@/renderer/lib/app/ipc";
import { queryClient } from "@/renderer/lib/app/query-client";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { relativeTime } from "@/shared/format";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Tag } from "lucide-react";
import { useState } from "react";

/**
 * Releases view — Phase 3 §3.4
 *
 * List releases, create new releases with changelog generation.
 */

export function ReleasesView() {
  const { repoTarget, nwo } = useWorkspace();

  const releasesQuery = useQuery({
    queryKey: ["releases", "list", nwo],
    queryFn: () => ipc("releases.list", { ...repoTarget }),
    staleTime: 60_000,
  });

  // Check if user has push permission (needed to create releases)
  const repoInfoQuery = useQuery({
    queryKey: ["repo", "info", nwo],
    queryFn: () => ipc("repo.info", { ...repoTarget }),
    staleTime: 300_000,
  });

  const releases = releasesQuery.data ?? [];
  const canCreateRelease = repoInfoQuery.data?.canPush ?? false;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-text-primary text-2xl italic">Releases</h1>
            <p className="text-text-secondary mt-1 text-sm">Manage releases for this repo.</p>
          </div>
          {canCreateRelease && <CreateReleaseDialog latestTag={releases[0]?.tagName} />}
        </div>

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
            <p className="text-text-tertiary text-sm">No releases found</p>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3">
          {releases.map((release) => (
            <div
              key={release.tagName}
              className="border-border bg-bg-raised rounded-lg border p-4"
            >
              <div className="flex items-center gap-2">
                <Tag
                  size={14}
                  className="text-primary shrink-0"
                />
                <h3 className="text-text-primary text-sm font-semibold">
                  {release.name || release.tagName}
                </h3>
                <Badge
                  variant="outline"
                  className="border-primary/30 text-primary font-mono text-[10px]"
                >
                  {release.tagName}
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
                <span>{release.author.login}</span>
                <span className="text-text-ghost">·</span>
                <span>{relativeTime(new Date(release.createdAt))}</span>
              </div>
              {release.body && (
                <div className="mt-3">
                  <MarkdownBody
                    content={release.body}
                    className="text-xs"
                  />
                </div>
              )}
            </div>
          ))}
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
          <Button className="bg-primary text-primary-foreground hover:bg-accent-hover gap-1.5" />
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
              type="text"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              placeholder="Tag name (e.g. v1.2.0)"
              className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary flex-1 rounded-md border px-3 py-2 font-mono text-xs focus:outline-none"
            />
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="Target branch"
              className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary w-28 rounded-md border px-3 py-2 font-mono text-xs focus:outline-none"
            />
          </div>
          <input
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
                  {changelogMutation.isPending ? "Generating..." : "Generate changelog"}
                </button>
              )}
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="Describe this release..."
              className="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-primary mt-1 w-full resize-none rounded-md border px-3 py-2 font-mono text-xs leading-relaxed focus:outline-none"
            />
          </div>
          <div className="flex gap-4">
            <label className="text-text-secondary flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={isDraft}
                onChange={(e) => setIsDraft(e.target.checked)}
                className="accent-primary"
              />
              Draft
            </label>
            <label className="text-text-secondary flex cursor-pointer items-center gap-1.5 text-xs">
              <input
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
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <DialogClose
            render={
              <Button
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
