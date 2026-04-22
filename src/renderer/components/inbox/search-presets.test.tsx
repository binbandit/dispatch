import "@testing-library/jest-dom/vitest";
import { SearchPresetChips } from "@/renderer/components/inbox/search-presets";
import { getPrSearchPresets, type PrSearchPreset } from "@/renderer/lib/inbox/pr-search-presets";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

describe("SearchPresetChips", () => {
  it("marks an already selected preset as active when clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn<(preset: PrSearchPreset, isActive: boolean) => void>();
    const [needsReviewPreset] = getPrSearchPresets("sidebar");

    render(
      <SearchPresetChips
        activeQuery={needsReviewPreset?.query ?? ""}
        onSelect={onSelect}
        presets={getPrSearchPresets("sidebar")}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: needsReviewPreset?.label ?? "Needs review" }),
    );

    expect(onSelect).toHaveBeenCalledWith(needsReviewPreset, true);
  });

  it("marks an unselected preset as inactive when clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn<(preset: PrSearchPreset, isActive: boolean) => void>();
    const [needsReviewPreset] = getPrSearchPresets("sidebar");

    render(
      <SearchPresetChips
        activeQuery=""
        onSelect={onSelect}
        presets={getPrSearchPresets("sidebar")}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: needsReviewPreset?.label ?? "Needs review" }),
    );

    expect(onSelect).toHaveBeenCalledWith(needsReviewPreset, false);
  });
});
