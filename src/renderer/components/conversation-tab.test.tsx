import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ContentEvent } from "./conversation-tab";

vi.mock(import("../lib/workspace-context"), () => ({
  useWorkspace: () => ({ cwd: "/tmp/dispatch" }),
}));

vi.mock(import("./github-avatar"), () => ({
  GitHubAvatar: ({ login }: { login: string }) => <div>{login} avatar</div>,
}));

vi.mock(import("./markdown-body"), () => ({
  MarkdownBody: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock(import("./reaction-bar"), () => ({
  ReactionBar: () => null,
}));

describe("ContentEvent", () => {
  it("toggles minimization when the comment header is clicked", async () => {
    const user = userEvent.setup();
    const onToggleMinimized = vi.fn();

    render(
      <ContentEvent
        commentId="comment-1"
        login="alice"
        action="commented"
        time={new Date("2026-04-01T10:00:00Z")}
        body="Looks good."
        repo="binbandit/dispatch"
        isBot={false}
        prNumber={42}
        onClick={vi.fn()}
        minimized={false}
        onToggleMinimized={onToggleMinimized}
        reactions={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /minimize comment from alice/i }));

    expect(onToggleMinimized.mock.calls).toHaveLength(1);
  });

  it("keeps the file path click target separate from the header toggle", async () => {
    const user = userEvent.setup();
    const onToggleMinimized = vi.fn();
    const onClick = vi.fn();

    render(
      <ContentEvent
        commentId="comment-1"
        login="alice"
        action="commented"
        time={new Date("2026-04-01T10:00:00Z")}
        body="Looks good."
        filePath="src/renderer/components/conversation-tab.tsx"
        repo="binbandit/dispatch"
        isBot={false}
        prNumber={42}
        onClick={onClick}
        minimized={false}
        onToggleMinimized={onToggleMinimized}
        reactions={[]}
      />,
    );

    await user.click(screen.getByText("src/renderer/components/conversation-tab.tsx"));

    expect(onClick.mock.calls).toHaveLength(1);
    expect(onToggleMinimized).not.toHaveBeenCalled();
  });
});
