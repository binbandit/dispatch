import "@testing-library/jest-dom/vitest";
import type { Highlighter } from "shiki";

import { MarkdownBody } from "@/renderer/components/shared/markdown-body";
import { render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const { ensureHighlighterResourcesMock, useSyntaxHighlighterMock } = vi.hoisted(() => ({
  ensureHighlighterResourcesMock: vi.fn(async () => false),
  useSyntaxHighlighterMock: vi.fn<() => Highlighter | null>(() => null),
}));

vi.mock(import("@/renderer/hooks/review/use-syntax-highlight"), () => ({
  useSyntaxHighlighter: () => useSyntaxHighlighterMock(),
}));

vi.mock(import("@/renderer/lib/review/highlighter"), async () => {
  const actual = await vi.importActual<typeof import("@/renderer/lib/review/highlighter")>(
    "@/renderer/lib/review/highlighter",
  );

  return {
    ...actual,
    ensureHighlighterResources: ensureHighlighterResourcesMock,
  };
});

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
    disableFontLigatures: false,
    setThemeStyle: vi.fn(),
    setColorMode: vi.fn(),
    setCodeTheme: vi.fn(),
    setDisableFontLigatures: vi.fn(),
  }),
}));

describe("MarkdownBody", () => {
  afterEach(() => {
    useSyntaxHighlighterMock.mockReset();
    useSyntaxHighlighterMock.mockReturnValue(null);
    ensureHighlighterResourcesMock.mockClear();
  });

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
    const alertElement = alert as HTMLElement;

    expect(
      within(alertElement).getByRole("heading", {
        name: /add filesystem browser to command palette for adding projects/i,
        level: 3,
      }),
    ).toBeInTheDocument();
    expect(within(alertElement).getByText("NOTE")).toBeInTheDocument();
    expect(within(alertElement).getByText(/macroscope summarized 6bad735/i)).toBeVisible();
    expect(
      within(alertElement).getByRole("heading", { name: /filtered issues/i, level: 3 }),
    ).toBeInTheDocument();
    expect(alert?.querySelector("details")).not.toBeNull();
  });

  it("does not pass ReactMarkdown internal props to image elements", () => {
    const { getByRole } = render(
      <MarkdownBody content="![attachment](https://github.com/user-attachments/assets/example.png)" />,
    );
    const image = getByRole("img", { name: "attachment" });

    expect(image).not.toHaveAttribute("node");
  });

  it("normalizes js fenced blocks to javascript highlighting", () => {
    const codeToTokens = vi.fn(() => ({
      tokens: [
        [
          { content: "const", color: "#d4883a" },
          { content: " value = 1;", color: "#f0ece6" },
        ],
      ],
    }));

    useSyntaxHighlighterMock.mockReturnValue({
      codeToTokens,
      getLoadedLanguages: () => ["javascript"],
    } as unknown as Highlighter);

    const { container } = render(
      <MarkdownBody
        content={"```js\nconst value = 1;\n```"}
        repo="binbandit/dispatch"
      />,
    );

    expect(codeToTokens).toHaveBeenCalledWith(
      "const value = 1;",
      expect.objectContaining({ lang: "javascript" }),
    );
    expect(container.querySelector("code span")).not.toBeNull();
  });
});
