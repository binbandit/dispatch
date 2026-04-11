import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shaped skeleton placeholders for loading states.
 * Replaces generic Spinner with content-shaped placeholders.
 */

export function PrDetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header skeleton */}
      <div className="border-border bg-bg-surface border-b px-5 py-3">
        <div className="flex items-start gap-3">
          <Skeleton className="h-7 w-7 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-3/4" />
            <div className="mt-2 flex gap-2">
              <Skeleton className="h-4 w-20 rounded-sm" />
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        </div>
        <div className="mt-3 flex gap-2 pl-10">
          <Skeleton className="h-7 w-20 rounded-md" />
          <Skeleton className="h-7 w-32 rounded-md" />
          <Skeleton className="h-7 w-28 rounded-md" />
        </div>
      </div>
      {/* Diff area skeleton */}
      <div className="flex flex-1">
        <div className="flex-1 overflow-hidden">
          <DiffSkeleton />
        </div>
        <div className="border-border w-[320px] border-l p-4">
          <SidePanelSkeleton />
        </div>
      </div>
    </div>
  );
}

// Deterministic line widths so the skeleton is stable across re-renders.
const CODE_LINE_WIDTHS = [
  "62%", "45%", "78%", "34%", "91%", "55%", "70%", "42%", "86%", "50%",
  "67%", "38%", "74%", "58%", "82%", "46%", "60%", "72%", "40%", "88%",
];

export function DiffSkeleton() {
  return (
    <div className="flex flex-col">
      {/* Toolbar skeleton — mirrors DiffToolbar h-8 bar */}
      <div className="border-border-subtle bg-bg-surface flex h-8 shrink-0 items-center gap-2 border-b px-3">
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-3 w-20 opacity-60" />
        <div className="flex-1" />
        <Skeleton className="h-5 w-16 rounded-md" />
        <Skeleton className="h-5 w-16 rounded-md" />
        <Skeleton className="h-5 w-[54px] rounded-md" />
        <div className="bg-border mx-0.5 h-3.5 w-px" />
        <Skeleton className="h-4 w-4 rounded-sm" />
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-4 w-4 rounded-sm" />
      </div>
      {/* Hunk header */}
      <div className="border-border-subtle bg-bg-raised flex h-5 items-center border-b px-3">
        <Skeleton className="h-2.5 w-48 rounded-sm" />
      </div>
      {/* Code lines — mirrors DiffLineRow structure */}
      {CODE_LINE_WIDTHS.map((width, i) => (
        <div
          key={i}
          className="flex h-5 items-center"
        >
          {/* Color bar */}
          <div className="w-[3px] shrink-0" />
          {/* Line number gutter */}
          <div className="border-border/40 flex w-14 shrink-0 items-center justify-end border-r pr-2">
            <Skeleton className="h-2.5 w-5 rounded-sm" />
          </div>
          {/* Diff marker */}
          <div className="w-5 shrink-0" />
          {/* Code content */}
          <div className="min-w-0 flex-1 pl-1 pr-3">
            <Skeleton
              className="h-2.5 rounded-sm"
              style={{ width }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SidePanelSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {/* Tabs */}
      <div className="flex gap-3">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-4 w-16" />
      </div>
      {/* Description */}
      <div className="flex flex-col gap-2 pt-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
      {/* Reviews */}
      <div className="flex flex-col gap-2 pt-3">
        <Skeleton className="h-2 w-12" />
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-2"
          >
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="ml-auto h-4 w-16 rounded-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function FileTreeSkeleton() {
  return (
    <div className="flex flex-col gap-1 p-2">
      {/* Progress bar */}
      <div className="flex items-center gap-2 px-1 pb-2">
        <Skeleton className="h-[3px] flex-1 rounded-full" />
        <Skeleton className="h-3 w-10" />
      </div>
      {/* Directory */}
      <div className="flex items-center gap-1.5 py-1">
        <Skeleton className="h-3 w-3" />
        <Skeleton className="h-3 w-16" />
      </div>
      {/* Files */}
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-1.5 py-1 pl-4"
        >
          <Skeleton className="h-3 w-3" />
          <Skeleton
            className="h-3"
            style={{ width: `${40 + Math.random() * 40}%` }}
          />
          <Skeleton className="ml-auto h-3 w-8" />
        </div>
      ))}
    </div>
  );
}

export function PrInboxSkeleton() {
  return (
    <div className="flex flex-col gap-0">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="flex items-start gap-2.5 border-l-2 border-l-transparent px-3 py-2.5"
        >
          <Skeleton className="mt-0.5 h-5 w-5 rounded-full" />
          <div className="flex-1">
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-5 rounded-sm" />
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              <Skeleton className="h-2 w-2 rounded-full" />
              <Skeleton className="h-2 w-8" />
              <Skeleton className="h-2 w-16" />
              <Skeleton className="h-2 w-14" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChecksPanelSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-md px-2 py-1.5"
        >
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

export function WorkflowRunsSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="border-border-subtle flex items-center gap-3 border-b px-5 py-2.5"
        >
          <Skeleton className="h-4 w-4 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-3 w-3/4" />
            <div className="mt-1 flex gap-1.5">
              <Skeleton className="h-2 w-20" />
              <Skeleton className="h-2 w-16" />
              <Skeleton className="h-2 w-14" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
