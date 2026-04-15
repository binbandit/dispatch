import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { ExperimentalSettingsSection } from "./settings-experimental";

describe("ExperimentalSettingsSection", () => {
  it("renders the experimental disclaimer and saves toggled flags", async () => {
    const user = userEvent.setup();
    const savePref = vi.fn();

    render(
      <ExperimentalSettingsSection
        prefs={{ experimentalOledTheme: "false" }}
        savePref={savePref}
      />,
    );

    expect(screen.getByText(/they may change or disappear between releases/i)).toBeInTheDocument();
    expect(screen.getByText("OLED theme")).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: /oled theme/i }));
    expect(savePref).toHaveBeenCalledWith("experimentalOledTheme", "true");
  });
});
