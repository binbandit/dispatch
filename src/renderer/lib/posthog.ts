import posthog from "posthog-js";

import { ipc } from "./ipc";

let initialized = false;

/**
 * Initialize PostHog analytics.
 *
 * Only activates if the user has opted in via preferences.
 * No code content, PR bodies, or diff data is ever sent.
 */
export async function initPostHog(): Promise<void> {
  if (initialized) {
    return;
  }

  const prefs = await ipc("preferences.getAll", { keys: ["analytics-opted-in"] });
  if (prefs["analytics-opted-in"] !== "true") {
    return;
  }

  posthog.init(
    import.meta.env.VITE_PUBLIC_POSTHOG_KEY ?? "phc_kWndtfXvfd7tjafTSNXt3OYUJUXgHioqfddLIotZ7u5",
    {
      api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      persistence: "localStorage",
      loaded: (ph) => {
        ipc("env.user")
          .then((user) => {
            if (user?.login) {
              ph.identify(user.login, { name: user.name ?? user.login });
            }
          })
          .catch(() => {});
      },
    },
  );

  initialized = true;
}

/**
 * Track a product event. NEVER include code content or PR data.
 */
export function track(event: string, properties?: Record<string, string | number | boolean>): void {
  if (!initialized) {
    return;
  }
  posthog.capture(event, properties);
}

/**
 * Track a view navigation.
 */
export function trackPage(view: string): void {
  if (!initialized) {
    return;
  }
  posthog.capture("$pageview", { $current_url: `dispatch://${view}` });
}

/**
 * Shut down PostHog.
 */
export function shutdownPostHog(): void {
  if (!initialized) {
    return;
  }
  posthog.reset();
  initialized = false;
}
