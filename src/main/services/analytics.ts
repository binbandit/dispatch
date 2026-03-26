import { BrowserWindow } from "electron";

import { ANALYTICS_CHANNEL } from "../../shared/ipc";

/**
 * Send an analytics event from the main process to the renderer's PostHog.
 *
 * The renderer-side PostHog instance handles the opt-in check — if the user
 * hasn't enabled analytics, `track()` is a no-op, so events sent here are
 * silently dropped.
 *
 * NEVER include code content, file paths, PR bodies, or diff data.
 */
export function trackFromMain(
  event: string,
  properties?: Record<string, string | number | boolean>,
): void {
  const [win] = BrowserWindow.getAllWindows();
  if (!win) {
    return;
  }
  win.webContents.send(ANALYTICS_CHANNEL, { event, properties });
}
