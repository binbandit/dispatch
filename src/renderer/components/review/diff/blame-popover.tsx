import type { BlameLine } from "@/shared/ipc";

import { Popover, PopoverPrimitive, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { ipc } from "@/renderer/lib/app/ipc";
import { useWorkspace } from "@/renderer/lib/app/workspace-context";
import { relativeTime } from "@/shared/format";
import { useQuery } from "@tanstack/react-query";
import { GitCommitHorizontal, History } from "lucide-react";
import { useState } from "react";

/**
 * Inline blame action for diff rows.
 *
 * The old behavior opened a custom-positioned popover when hovering any line.
 * This version makes blame explicit and anchored to a line action button, which
 * better matches the rest of Dispatch's diff interactions.
 */

interface BlameButtonProps {
  file: string;
  line: number;
  gitRef: string;
  className?: string;
}

export function BlameButton({ file, line, gitRef, className }: BlameButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger
        aria-label={`Show git blame for line ${line}`}
        className={cn(
          className,
          "data-[state=open]:pointer-events-auto data-[state=open]:opacity-100",
        )}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        tabIndex={-1}
        type="button"
      >
        <History size={10} />
      </PopoverTrigger>

      {open && (
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Positioner
            align="start"
            className="z-50 h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom,transform] data-instant:transition-none"
            side="right"
            sideOffset={10}
          >
            <PopoverPrimitive.Popup
              className="border-border-strong bg-bg-elevated relative flex w-[280px] origin-(--transform-origin) rounded-md border shadow-md transition-[scale,opacity] outline-none data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0"
              finalFocus={false}
              initialFocus={false}
            >
              <BlamePopoverContent
                file={file}
                gitRef={gitRef}
                line={line}
              />
            </PopoverPrimitive.Popup>
          </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
      )}
    </Popover>
  );
}

function BlamePopoverContent({ file, line, gitRef }: Omit<BlameButtonProps, "className">) {
  const { cwd } = useWorkspace();

  const blameQuery = useQuery({
    queryKey: ["git", "blame", cwd, file, line, gitRef],
    queryFn: () => ipc("git.blame", { cwd: cwd!, file, line, ref: gitRef }),
    enabled: cwd !== null,
    staleTime: 300_000,
    retry: 0,
  });

  if (blameQuery.isLoading) {
    return (
      <div className="text-text-secondary flex items-center gap-2 px-2.5 py-2 text-[11px]">
        <Spinner className="text-accent-text h-3 w-3" />
        <span>Loading blame…</span>
      </div>
    );
  }

  if (blameQuery.isError || !hasBlameData(blameQuery.data)) {
    return (
      <div className="text-text-secondary flex items-center gap-2 px-2.5 py-2 text-[11px]">
        <History
          size={11}
          className="text-text-tertiary shrink-0"
        />
        <span>No blame available for this line.</span>
      </div>
    );
  }

  const blame = blameQuery.data;

  return (
    <div className="flex flex-col gap-2 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-accent-text font-mono text-[9px] font-medium tracking-[0.08em] uppercase">
          Blame
        </span>
        <span className="border-border bg-bg-raised text-text-tertiary inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[9px]">
          <GitCommitHorizontal size={9} />
          {blame.sha.slice(0, 8)}
        </span>
      </div>

      <div className="flex items-start gap-2">
        <div className="border-border-accent bg-accent-muted text-accent-text flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border font-mono text-[8px] font-semibold">
          {getAuthorInitials(blame.author)}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-text-primary truncate text-[11px] font-medium">
              {blame.author}
            </span>
            <span className="text-text-tertiary font-mono text-[10px]">
              {formatBlameDate(blame.date)}
            </span>
          </div>
          <p className="text-text-secondary max-w-[200px] truncate text-[11px]">{blame.summary}</p>
        </div>
      </div>
    </div>
  );
}

function hasBlameData(blame: BlameLine | undefined): blame is BlameLine {
  if (!blame) {
    return false;
  }

  return Boolean(blame.sha || blame.author || blame.summary);
}

function formatBlameDate(date: string): string {
  if (!date) {
    return "Unknown time";
  }

  return relativeTime(new Date(date));
}

function getAuthorInitials(author: string): string {
  const parts = author.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
