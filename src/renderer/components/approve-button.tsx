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
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Dices } from "lucide-react";
import { useState } from "react";

import { ipc } from "../lib/ipc";
import { queryClient } from "../lib/query-client";
import { MentionTextarea } from "./mention-textarea";

/**
 * Approve button — quick approve or approve with optional comment + LGTM gif.
 */

const LGTM_API_URL = "https://lgtm-api.vercel.app/api/gifs";

interface LgtmGif {
  url: string;
  name: string;
}

export function ApproveButton({
  cwd,
  prNumber,
  currentUserReview,
}: {
  cwd: string;
  prNumber: number;
  /** The current user's most recent review state, or null if they haven't reviewed */
  currentUserReview: string | null;
}) {
  const [body, setBody] = useState("");
  const alreadyApproved = currentUserReview === "APPROVED";

  const lgtmQuery = useQuery({
    queryKey: ["lgtm-gifs"],
    queryFn: async () => {
      const res = await fetch(LGTM_API_URL);
      if (!res.ok) throw new Error("Failed to fetch LGTM gifs");
      return res.json() as Promise<LgtmGif[]>;
    },
    staleTime: Infinity,
  });

  const reviewMutation = useMutation({
    mutationFn: (args: {
      cwd: string;
      prNumber: number;
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
    }) => ipc("pr.submitReview", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({ title: "PR approved", type: "success" });
      setBody("");
    },
    onError: (err) => {
      toastManager.add({
        title: "Review failed",
        description: String(err.message),
        type: "error",
      });
    },
  });

  function handleQuickApprove() {
    reviewMutation.mutate({ cwd, prNumber, event: "APPROVE" });
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
    if (!gifs || gifs.length === 0) return;
    const gif = gifs[Math.floor(Math.random() * gifs.length)]!;
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
        onOpenChange={(open) => {
          if (!open) {
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
            <MentionTextarea
              value={body}
              onChange={setBody}
              placeholder="LGTM! Ship it."
              rows={4}
              prNumber={prNumber}
              textareaClassName="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-success w-full resize-none rounded-md border px-3 py-2.5 text-xs leading-relaxed focus:outline-none"
            />
            <button
              type="button"
              onClick={insertLgtmGif}
              disabled={lgtmQuery.isLoading}
              className="text-text-tertiary hover:text-text-primary mt-1.5 flex cursor-pointer items-center gap-1 text-[11px] disabled:opacity-40"
            >
              {lgtmQuery.isLoading ? <Spinner className="h-3 w-3" /> : <Dices size={13} />}
              {lgtmQuery.isLoading ? "Loading gifs..." : "Insert random LGTM gif"}
            </button>
          </div>
          <DialogFooter variant="bare">
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <DialogClose
              render={
                <Button
                  className="bg-success hover:bg-success/90 text-bg-root"
                  disabled={reviewMutation.isPending}
                  onClick={() => {
                    reviewMutation.mutate({
                      cwd,
                      prNumber,
                      event: "APPROVE",
                      body: body.trim() || undefined,
                    });
                  }}
                />
              }
            >
              {reviewMutation.isPending ? <Spinner className="h-3 w-3" /> : "✓ Approve"}
            </DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
