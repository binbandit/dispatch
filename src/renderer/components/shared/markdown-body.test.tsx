import "@testing-library/jest-dom/vitest";
import { MarkdownBody } from "@/renderer/components/shared/markdown-body";
import { render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock(import("@/renderer/hooks/review/use-syntax-highlight"), () => ({
  useSyntaxHighlighter: () => null,
}));

vi.mock(import("@/renderer/lib/app/open-external"), () => ({
  openExternal: vi.fn(),
}));

vi.mock(import("@/renderer/lib/app/theme-context"), () => ({
  useTheme: () => ({
    themeStyle: "default",
    colorMode: "dark",
    codeTheme: "github-dark-default",
    codeThemeDark: "github-dark-default",
    codeThemeLight: "github-light-default",
    resolvedTheme: "dark",
    setThemeStyle: vi.fn(),
    setColorMode: vi.fn(),
    setCodeTheme: vi.fn(),
  }),
}));

describe("MarkdownBody", () => {
  it("keeps blank quoted lines and nested details inside GitHub alerts", () => {
    const content = `> [!NOTE]
> ### Add filesystem browser to command palette for adding projects
> - Adds a filesystem browsing mode to the command palette.
>
> <details>
> <summary>📊 Macroscope summarized 6bad735</summary>
>
> ### 🗂️ Filtered Issues
>
> </details>`;

    const { container } = render(
      <MarkdownBody
        content={content}
        repo="pingdotgg/t3code"
      />,
    );

    const alert = container.querySelector(".gh-alert");

    expect(alert).not.toBeNull();
    if (!alert) {
      throw new Error("Expected GitHub alert to render.");
    }

    expect(container.querySelector("blockquote")).toBeNull();
    expect(
      within(alert).getByRole("heading", {
        name: /add filesystem browser to command palette for adding projects/i,
        level: 3,
      }),
    ).toBeInTheDocument();
    expect(within(alert).getByText("NOTE")).toBeInTheDocument();
    expect(within(alert).getByText(/macroscope summarized 6bad735/i)).toBeVisible();
    expect(
      within(alert).getByRole("heading", { name: /filtered issues/i, level: 3 }),
    ).toBeInTheDocument();
    expect(alert?.querySelector("details")).not.toBeNull();
  });
});
