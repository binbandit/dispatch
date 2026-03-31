import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EnvCheck, ENV_CHECK_WINDOW_DRAG_STYLE, ENV_CHECK_WINDOW_NO_DRAG_STYLE } from "./env-check";

describe("EnvCheck", () => {
  it("keeps the screen draggable while preserving interactive controls", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <EnvCheck
        ghVersion={null}
        gitVersion={null}
        ghAuth={false}
        onRetry={onRetry}
      />,
    );

    const retryButton = screen.getByRole("button", { name: "Retry" });

    expect(container.firstElementChild).not.toBeNull();
    expect(ENV_CHECK_WINDOW_DRAG_STYLE).toEqual({ WebkitAppRegion: "drag" });
    expect(ENV_CHECK_WINDOW_NO_DRAG_STYLE).toEqual({ WebkitAppRegion: "no-drag" });

    await user.click(retryButton);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
