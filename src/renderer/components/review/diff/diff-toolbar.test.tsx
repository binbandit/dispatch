import "@testing-library/jest-dom/vitest";
import type * as TooltipModule from "@/components/ui/tooltip";
import type { ReactNode } from "react";

import { DiffToolbar } from "@/renderer/components/review/diff/diff-toolbar";
import { parseDiff } from "@/renderer/lib/review/diff-parser";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock(import("@/hooks/use-media-query"), () => ({
  useMediaQuery: () => false,
}));

vi.mock(import("@/components/ui/tooltip"), () => ({
  const Tooltip = (({ children }: { children?: ReactNode }) => <>{children ?? null}</>) as unknown as
    typeof TooltipModule.Tooltip;
  const TooltipTrigger = ((props: { render?: unknown }) => {
    const { render } = props;
    if (typeof render === "function") {
      return null;
    }

    return <>{(render as ReactNode) ?? null}</>;
  }) as unknown as typeof TooltipModule.TooltipTrigger;
  const TooltipPopup = (({ children }: { children?: ReactNode }) => <>{children ?? null}</>) as unknown as
    typeof TooltipModule.TooltipPopup;

  return { Tooltip, TooltipTrigger, TooltipPopup };
});

const SIMPLE_DIFF = `diff --git a/src/example.ts b/src/example.ts
index abc1234..def5678 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,3 @@
 export function example() {
-  return "before";
+  return "after";
 }`;

describe("DiffToolbar", () => {
  it("shows a spinner and disables toolbar actions while full file content is loading", () => {
    const currentFile = parseDiff(SIMPLE_DIFF)[0]!;

    render(
      <DiffToolbar
        currentFile={currentFile}
        currentIndex={1}
        totalFiles={3}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        diffMode="all"
        onDiffModeChange={vi.fn()}
        hasLastReview
        viewMode="unified"
        onViewModeChange={vi.fn()}
        isViewed={false}
        onToggleViewed={vi.fn()}
        onAiSuggest={vi.fn()}
        isAiSuggesting={false}
        aiSuggestEnabled
        isFullFileLoading
      />,
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Since review" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "AI review" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Unified diff" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Split diff" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Loading full file" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mark file as viewed" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous file" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next file" })).toBeDisabled();
  });
});
