/**
 * Desktop notification helper.
 *
 * Uses the Web Notification API which Electron supports natively.
 * Shows native macOS/Windows notifications with the Dispatch icon.
 *
 * Notification types map to distinct prefixes so the user can
 * visually distinguish them in the OS notification center:
 *
 *   "review"  → "Review requested"
 *   "ci-fail" → "CI failed"
 *   "approve" → "PR approved"
 *   "merge"   → "PR merged"
 *   "generic" → plain title
 */

export type NotificationType = "review" | "ci-fail" | "approve" | "merge" | "generic";

const NOTIFICATION_CONFIG: Record<NotificationType, { tag: string }> = {
  review: { tag: "dispatch-review" },
  "ci-fail": { tag: "dispatch-ci" },
  approve: { tag: "dispatch-approve" },
  merge: { tag: "dispatch-merge" },
  generic: { tag: "dispatch" },
};

export function sendNotification(
  title: string,
  body: string,
  type: NotificationType = "generic",
): void {
  const config = NOTIFICATION_CONFIG[type];

  const show = () => {
    void new Notification(title, {
      body,
      silent: false,
      tag: config.tag,
      // Electron automatically uses the app icon for notifications on macOS.
      // On Windows/Linux, we can specify an icon path — the renderer doesn't
      // Have direct filesystem access in sandbox mode, so we rely on the
      // Default app icon set in BrowserWindow config.
    });
  };

  if (Notification.permission === "granted") {
    show();
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission()
      .then((permission) => {
        if (permission === "granted") {
          show();
        }
      })
      .catch(() => {
        // Permission request failed — no notification
      });
  }
}
