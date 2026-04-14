/* eslint-disable import/max-dependencies -- Approval dialogs intentionally compose dialog primitives, network helpers, and the shared composer in one focused review surface. */
import type { RepoTarget } from "@/shared/ipc";

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
import { ReviewMarkdownComposer } from "@/renderer/components/review/comments/review-markdown-composer";
import { useReviewMutation } from "@/renderer/hooks/review/use-review-mutation";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Dices } from "lucide-react";
import { useState } from "react";

/**
 * Approve button — quick approve or approve with optional comment + LGTM gif.
 */

const LGTM_API_URL = "https://lgtm-api.vercel.app/api/gifs";

interface LgtmGif {
  url: string;
  name: string;
}

export function ApproveButton({
  repoTarget,
  prNumber,
  currentUserReview,
}: {
  repoTarget: RepoTarget;
  prNumber: number;
  /** The current user's most recent review state, or null if they haven't reviewed */
  currentUserReview: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const alreadyApproved = currentUserReview === "APPROVED";

  const lgtmQuery = useQuery({
    queryKey: ["lgtm-gifs"],
    queryFn: async () => {
      const res = await fetch(LGTM_API_URL);
      if (!res.ok) {
        throw new Error("Failed to fetch LGTM gifs");
      }
      return res.json() as Promise<LgtmGif[]>;
    },
    staleTime: Infinity,
  });

  const reviewMutation = useReviewMutation({
    repoTarget,
    prNumber,
    successTitle: "PR approved",
    onSuccess: () => {
      setBody("");
      setOpen(false);
    },
  });

  function handleQuickApprove() {
    reviewMutation.mutate({ event: "APPROVE" });
  }

  function insertLgtmGif() {
    if (lgtmQuery.isLoading) {
      return;
    }
    if (lgtmQuery.isError) {
      toastManager.add({ title: "LGTM gifs unavailable", type: "error" });
      return;
    }
    const gifs = lgtmQuery.data;
    if (!gifs || gifs.length === 0) {
      return;
    }
    const gif = gifs.at(Math.floor(Math.random() * gifs.length));
    if (!gif) {
      return;
    }
    setBody((prev) => {
      const prefix = prev.trim() ? `${prev.trim()}\n\n` : "";
      return `${prefix}![LGTM](${gif.url})`;
    });
  }

  if (alreadyApproved) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="border-success/30 text-success gap-1.5 opacity-60"
        disabled
      >
        ✓ Approved
      </Button>
    );
  }

  return (
    <div className="flex">
      {/* Quick approve (no message) */}
      <Button
        size="sm"
        variant="outline"
        className="border-success/30 text-success hover:bg-success-muted gap-1.5 rounded-r-none"
        disabled={reviewMutation.isPending}
        onClick={handleQuickApprove}
      >
        {reviewMutation.isPending ? <Spinner className="h-3 w-3" /> : "✓"}
        Approve
      </Button>
      {/* Expand for message — opens Dialog */}
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setBody("");
          }
        }}
      >
        <DialogTrigger
          render={
            <Button
              size="sm"
              variant="outline"
              className="border-success/30 text-success hover:bg-success-muted rounded-l-none border-l-0 px-1.5"
              disabled={reviewMutation.isPending}
            />
          }
        >
          <ChevronDown size={11} />
        </DialogTrigger>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve with comment</DialogTitle>
            <DialogDescription>Optionally leave a message with your approval.</DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-2">
            <ReviewMarkdownComposer
              autoFocus
              onChange={setBody}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  reviewMutation.mutate({
                    event: "APPROVE",
                    body: body.trim() || undefined,
                  });
                }
              }}
              placeholder="LGTM! Ship it."
              prNumber={prNumber}
              rows={5}
              value={body}
            />
            <button
              type="button"
              onClick={insertLgtmGif}
              disabled={lgtmQuery.isLoading}
              className="text-text-tertiary hover:text-text-primary mt-1.5 flex cursor-pointer items-center gap-1 text-[11px] disabled:opacity-40"
            >
              {lgtmQuery.isLoading ? <Spinner className="h-3 w-3" /> : <Dices size={13} />}
              {lgtmQuery.isLoading ? "Loading gifs…" : "Insert random LGTM gif"}
            </button>
          </div>
          <DialogFooter variant="bare">
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button
              className="bg-success hover:bg-success/90 text-bg-root"
              disabled={reviewMutation.isPending}
              onClick={() => {
                reviewMutation.mutate({
                  event: "APPROVE",
                  body: body.trim() || undefined,
                });
              }}
            >
              {reviewMutation.isPending ? <Spinner className="h-3 w-3" /> : "✓ Approve"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
