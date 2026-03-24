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
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, Dices } from "lucide-react";
import { useState } from "react";

import { ipc } from "../lib/ipc";
import { queryClient } from "../lib/query-client";
import { MentionTextarea } from "./mention-textarea";

/**
 * Approve button — quick approve or approve with optional comment + LGTM gif.
 */

const LGTM_GIFS = [
  "https://media.giphy.com/media/111ebonMs90YLu/giphy.gif",
  "https://media.giphy.com/media/3o7TKF1fSIs1R19B8k/giphy.gif",
  "https://media.giphy.com/media/l0MYt5jPR6QX5APm0/giphy.gif",
  "https://media.giphy.com/media/3oEjHV0z8S7WM4MwnK/giphy.gif",
  "https://media.giphy.com/media/xT0xeJpnrWC3XWblEk/giphy.gif",
  "https://media.giphy.com/media/26u4lOMA8JKSnL9Uk/giphy.gif",
  "https://media.giphy.com/media/3o7abB06u9bNzA8lu8/giphy.gif",
  "https://media.giphy.com/media/XreQmk7ETCak0/giphy.gif",
  "https://media.giphy.com/media/l3q2XhfQ8oCkm1Ts4/giphy.gif",
  "https://media.giphy.com/media/3ohzdIuqJoo8QdKlnW/giphy.gif",
];

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
    const gif = LGTM_GIFS[Math.floor(Math.random() * LGTM_GIFS.length)];
    setBody((prev) => {
      const prefix = prev.trim() ? `${prev.trim()}\n\n` : "";
      return `${prefix}![LGTM](${gif})`;
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
              className="text-text-tertiary hover:text-text-primary mt-1.5 flex cursor-pointer items-center gap-1 text-[11px]"
            >
              <Dices size={13} />
              Insert random LGTM gif
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
