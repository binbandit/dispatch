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
import { MessageSquare } from "lucide-react";
import { useState } from "react";

import { ipc } from "../lib/ipc";
import { queryClient } from "../lib/query-client";
import { MentionTextarea } from "./mention-textarea";

/**
 * Request Changes button — opens a dialog to describe what needs to change.
 */

export function RequestChangesButton({ cwd, prNumber }: { cwd: string; prNumber: number }) {
  const [body, setBody] = useState("");

  const reviewMutation = useMutation({
    mutationFn: (args: {
      cwd: string;
      prNumber: number;
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
    }) => ipc("pr.submitReview", args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pr"] });
      toastManager.add({ title: "Changes requested", type: "success" });
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

  return (
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
            variant="ghost"
            className="text-destructive hover:bg-danger-muted hover:text-destructive gap-1.5"
          />
        }
      >
        <MessageSquare size={13} />
        Request Changes
      </DialogTrigger>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request changes</DialogTitle>
          <DialogDescription>
            Describe what needs to change before this can be merged.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-2">
          <MentionTextarea
            value={body}
            onChange={setBody}
            placeholder="What needs to change?"
            rows={4}
            prNumber={prNumber}
            textareaClassName="border-border bg-bg-root text-text-primary placeholder:text-text-tertiary focus:border-destructive w-full resize-none rounded-md border px-3 py-2.5 text-xs leading-relaxed focus:outline-none"
          />
        </div>
        <DialogFooter variant="bare">
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <DialogClose
            render={
              <Button
                className="bg-destructive hover:bg-destructive/90 text-white"
                disabled={!body.trim() || reviewMutation.isPending}
                onClick={() => {
                  reviewMutation.mutate({
                    cwd,
                    prNumber,
                    event: "REQUEST_CHANGES",
                    body: body.trim(),
                  });
                }}
              />
            }
          >
            {reviewMutation.isPending ? <Spinner className="h-3 w-3" /> : "Submit"}
          </DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
