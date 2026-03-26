import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendNotification, type NotificationType } from "./notifications";

describe("sendNotification", () => {
  beforeEach(() => {
    // Reset Notification mock before each test
    vi.stubGlobal("Notification", {
      permission: "granted",
      requestPermission: vi.fn(),
    });
  });

  describe("when permission is granted", () => {
    it("sends notification with title and body", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      sendNotification("Test Title", "Test Body");

      expect(NotificationSpy).toHaveBeenCalledWith(
        "Test Title",
        expect.objectContaining({
          body: "Test Body",
          silent: false,
        }),
      );
    });

    it("uses generic tag by default", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      sendNotification("Title", "Body");

      expect(NotificationSpy).toHaveBeenCalledWith(
        "Title",
        expect.objectContaining({
          tag: "dispatch",
        }),
      );
    });

    it("uses review tag for review type", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      sendNotification("Review Requested", "PR #123", "review");

      expect(NotificationSpy).toHaveBeenCalledWith(
        "Review Requested",
        expect.objectContaining({
          tag: "dispatch-review",
        }),
      );
    });

    it("uses ci-fail tag for CI failure type", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      sendNotification("CI Failed", "PR #123", "ci-fail");

      expect(NotificationSpy).toHaveBeenCalledWith(
        "CI Failed",
        expect.objectContaining({
          tag: "dispatch-ci",
        }),
      );
    });

    it("uses approve tag for approve type", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      sendNotification("PR Approved", "PR #123", "approve");

      expect(NotificationSpy).toHaveBeenCalledWith(
        "PR Approved",
        expect.objectContaining({
          tag: "dispatch-approve",
        }),
      );
    });

    it("uses merge tag for merge type", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      sendNotification("PR Merged", "PR #123", "merge");

      expect(NotificationSpy).toHaveBeenCalledWith(
        "PR Merged",
        expect.objectContaining({
          tag: "dispatch-merge",
        }),
      );
    });

    it("sets silent to false", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      sendNotification("Title", "Body");

      expect(NotificationSpy).toHaveBeenCalledWith(
        "Title",
        expect.objectContaining({
          silent: false,
        }),
      );
    });
  });

  describe("when permission is not yet determined", () => {
    it("requests permission before showing notification", async () => {
      const requestPermission = vi.fn().mockResolvedValue("granted");
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "default";
      (Notification as any).requestPermission = requestPermission;

      sendNotification("Title", "Body");

      await vi.waitFor(() => {
        expect(requestPermission).toHaveBeenCalled();
      });
    });

    it("shows notification after permission granted", async () => {
      const requestPermission = vi.fn().mockResolvedValue("granted");
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "default";
      (Notification as any).requestPermission = requestPermission;

      sendNotification("Title", "Body");

      await vi.waitFor(() => {
        expect(NotificationSpy).toHaveBeenCalledWith("Title", expect.anything());
      });
    });

    it("does not show notification if permission denied", async () => {
      const requestPermission = vi.fn().mockResolvedValue("denied");
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "default";
      (Notification as any).requestPermission = requestPermission;

      sendNotification("Title", "Body");

      await vi.waitFor(() => {
        expect(requestPermission).toHaveBeenCalled();
      });

      // Wait a bit to ensure notification wasn't called
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(NotificationSpy).not.toHaveBeenCalled();
    });

    it("handles permission request failure gracefully", async () => {
      const requestPermission = vi.fn().mockRejectedValue(new Error("Permission API error"));
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "default";
      (Notification as any).requestPermission = requestPermission;

      // Should not throw
      expect(() => sendNotification("Title", "Body")).not.toThrow();

      await vi.waitFor(() => {
        expect(requestPermission).toHaveBeenCalled();
      });
    });
  });

  describe("when permission is denied", () => {
    it("does not show notification", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "denied";

      sendNotification("Title", "Body");

      expect(NotificationSpy).not.toHaveBeenCalled();
    });

    it("does not request permission again", () => {
      const requestPermission = vi.fn();
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "denied";
      (Notification as any).requestPermission = requestPermission;

      sendNotification("Title", "Body");

      expect(requestPermission).not.toHaveBeenCalled();
    });
  });

  describe("notification types", () => {
    const types: Array<{ type: NotificationType; expectedTag: string }> = [
      { type: "review", expectedTag: "dispatch-review" },
      { type: "ci-fail", expectedTag: "dispatch-ci" },
      { type: "approve", expectedTag: "dispatch-approve" },
      { type: "merge", expectedTag: "dispatch-merge" },
      { type: "generic", expectedTag: "dispatch" },
    ];

    for (const { type, expectedTag } of types) {
      it(`type "${type}" uses tag "${expectedTag}"`, () => {
        const NotificationSpy = vi.fn();
        vi.stubGlobal("Notification", NotificationSpy);
        (Notification as any).permission = "granted";

        sendNotification("Title", "Body", type);

        expect(NotificationSpy).toHaveBeenCalledWith(
          "Title",
          expect.objectContaining({
            tag: expectedTag,
          }),
        );
      });
    }
  });

  describe("edge cases", () => {
    it("handles empty title", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      sendNotification("", "Body");

      expect(NotificationSpy).toHaveBeenCalledWith("", expect.anything());
    });

    it("handles empty body", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      sendNotification("Title", "");

      expect(NotificationSpy).toHaveBeenCalledWith(
        "Title",
        expect.objectContaining({
          body: "",
        }),
      );
    });

    it("handles very long title", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      const longTitle = "A".repeat(1000);
      sendNotification(longTitle, "Body");

      expect(NotificationSpy).toHaveBeenCalledWith(longTitle, expect.anything());
    });

    it("handles very long body", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      const longBody = "B".repeat(1000);
      sendNotification("Title", longBody);

      expect(NotificationSpy).toHaveBeenCalledWith(
        "Title",
        expect.objectContaining({
          body: longBody,
        }),
      );
    });

    it("handles special characters in title", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      sendNotification('Title with <html> & "quotes"', "Body");

      expect(NotificationSpy).toHaveBeenCalledWith(
        'Title with <html> & "quotes"',
        expect.anything(),
      );
    });

    it("handles special characters in body", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      sendNotification("Title", "Body with <script> & 'quotes'");

      expect(NotificationSpy).toHaveBeenCalledWith(
        "Title",
        expect.objectContaining({
          body: "Body with <script> & 'quotes'",
        }),
      );
    });

    it("handles unicode characters", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      sendNotification("✅ PR Approved", "🎉 Ready to merge");

      expect(NotificationSpy).toHaveBeenCalledWith(
        "✅ PR Approved",
        expect.objectContaining({
          body: "🎉 Ready to merge",
        }),
      );
    });
  });

  describe("real-world scenarios", () => {
    it("review request notification", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      sendNotification(
        "Review requested",
        "Alice requested your review on PR #123: Add new feature",
        "review",
      );

      expect(NotificationSpy).toHaveBeenCalledWith(
        "Review requested",
        expect.objectContaining({
          body: "Alice requested your review on PR #123: Add new feature",
          tag: "dispatch-review",
        }),
      );
    });

    it("CI failure notification", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      sendNotification("CI Failed", "PR #456: Tests failed on main branch", "ci-fail");

      expect(NotificationSpy).toHaveBeenCalledWith(
        "CI Failed",
        expect.objectContaining({
          body: "PR #456: Tests failed on main branch",
          tag: "dispatch-ci",
        }),
      );
    });

    it("approval notification", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      sendNotification("PR Approved", "Bob approved your PR #789", "approve");

      expect(NotificationSpy).toHaveBeenCalledWith(
        "PR Approved",
        expect.objectContaining({
          body: "Bob approved your PR #789",
          tag: "dispatch-approve",
        }),
      );
    });

    it("merge notification", () => {
      const NotificationSpy = vi.fn();
      vi.stubGlobal("Notification", NotificationSpy);
      (Notification as any).permission = "granted";

      sendNotification("PR Merged", "PR #101: Feature X has been merged to main", "merge");

      expect(NotificationSpy).toHaveBeenCalledWith(
        "PR Merged",
        expect.objectContaining({
          body: "PR #101: Feature X has been merged to main",
          tag: "dispatch-merge",
        }),
      );
    });
  });
});
