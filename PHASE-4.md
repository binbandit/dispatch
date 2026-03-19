# Phase 4: Distribution, Quality & Observability

## Context

Phases 1-3 built the product. Phase 4 makes it shippable and maintainable.

This phase focuses on: distribution (code signing, auto-update, CI pipeline, Homebrew), observability (PostHog analytics, Sentry crash reporting), testing, and polish (keyboard shortcut dialog, README). Browser extension, website, and monetization are deliberately deferred.

---

## Part A: Distribution & Auto-Update

### A1. Code Signing

Unsigned Electron apps trigger Gatekeeper warnings on macOS and SmartScreen on Windows. This kills adoption.

**macOS:**

1. Enroll in the Apple Developer Program ($99/year) to get a Developer ID certificate.
2. Configure `electron-builder` signing in `package.json`:
   ```json
   "mac": {
     "identity": "Developer ID Application: Your Name (TEAM_ID)",
     "hardenedRuntime": true,
     "gatekeeperAssess": false,
     "entitlements": "build/entitlements.mac.plist",
     "entitlementsInherit": "build/entitlements.mac.plist"
   }
   ```
3. Notarize with Apple via `@electron/notarize` (after-sign hook).

**New file:** `build/entitlements.mac.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
</dict>
</plist>
```

Entitlements explained:

- `allow-jit` + `allow-unsigned-executable-memory`: Required for Shiki WASM (syntax highlighting)
- `network.client`: Required for AI API calls and PostHog telemetry

**New file:** `scripts/notarize.js`

```javascript
const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== "darwin") return;
  await notarize({
    appBundleId: "dev.dispatch.app",
    appPath: context.appOutDir + "/" + context.packager.appInfo.productFilename + ".app",
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
};
```

**Windows:**

1. Get an EV code signing certificate (DigiCert, Sectigo) — $200-500/year.
2. Configure in `package.json`:
   ```json
   "win": {
     "signingHashAlgorithms": ["sha256"],
     "certificateFile": "path/to/cert.pfx",
     "certificatePassword": "${env.WIN_CERT_PASSWORD}"
   }
   ```

### A2. Auto-Update

Users should never manually download updates.

**Install:**

```bash
bun add electron-updater
```

Host releases on GitHub Releases. `electron-updater` supports this natively.

**Modify:** `src/main/index.ts`

```typescript
import { autoUpdater } from "electron-updater";

// After window creation:
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on("update-available", (info) => {
  mainWindow?.webContents.send("update-available", info.version);
});

autoUpdater.on("update-downloaded", (info) => {
  mainWindow?.webContents.send("update-downloaded", info.version);
});

// Check on launch, then every 4 hours
autoUpdater.checkForUpdates();
setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);
```

**New component:** `src/renderer/components/update-banner.tsx`

A subtle banner that slides down from the accent bar when an update is downloaded:

```
Update v0.2.0 ready — restart to apply  [Restart now]  [Later]
```

- Background: `var(--accent-muted)`
- Text: `var(--accent-text)`, 12px
- "Restart now": ghost button, accent color. Calls `window.api.invoke("app.restart")` (new IPC endpoint that calls `autoUpdater.quitAndInstall()`)
- "Later": dismisses until next launch
- Height: 32px, `transition: max-height 300ms var(--ease-out)`
- Listens for `update-downloaded` event via `window.api.on("update-downloaded", ...)`

**Add to `package.json` build config:**

```json
"publish": {
  "provider": "github",
  "owner": "dispatchdev",
  "repo": "dispatch"
}
```

### A3. Release CI Pipeline

**New file:** `.github/workflows/release.yml`

Triggered on push to a tag matching `v*`:

```yaml
name: Release
on:
  push:
    tags: ["v*"]

jobs:
  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run build
      - name: Build & sign macOS app
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          CSC_LINK: ${{ secrets.MAC_CERT_BASE64 }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CERT_PASSWORD }}
        run: npx electron-builder --mac --publish always

  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run build
      - name: Build & sign Windows app
        env:
          WIN_CSC_LINK: ${{ secrets.WIN_CERT_BASE64 }}
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CERT_PASSWORD }}
        run: npx electron-builder --win --publish always

  build-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run build
      - run: npx electron-builder --linux --publish always
```

### A4. Homebrew Cask

**New repo:** `dispatchdev/homebrew-tap`

```ruby
cask "dispatch" do
  version "0.1.0"
  sha256 "COMPUTED_SHA256"

  url "https://github.com/dispatchdev/dispatch/releases/download/v#{version}/Dispatch-#{version}-arm64.dmg"
  name "Dispatch"
  desc "CI/CD-integrated code review desktop app"
  homepage "https://dispatch.dev"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "Dispatch.app"

  zap trash: [
    "~/Library/Application Support/Dispatch",
    "~/Library/Preferences/dev.dispatch.app.plist",
  ]
end
```

Installation: `brew install dispatchdev/tap/dispatch`

---

## Part B: Observability — PostHog + Sentry

### B1. PostHog Analytics

PostHog gives us product analytics, feature flags, and session replay — all self-hostable if needed for enterprise.

**Install:**

```bash
bun add posthog-js
```

**New file:** `src/renderer/lib/posthog.ts`

```typescript
import posthog from "posthog-js";

import { ipc } from "./ipc";

let initialized = false;

/**
 * Initialize PostHog.
 *
 * Only activates if the user has opted in via preferences.
 * Identifies the user by their GitHub login (already available from env.user).
 * No code content, PR bodies, or diff data is ever sent.
 */
export async function initPostHog(): Promise<void> {
  if (initialized) return;

  // Check opt-in preference
  const prefs = await ipc("preferences.getAll", {});
  const optedIn = prefs["analytics-opted-in"] === "true";

  if (!optedIn) return;

  posthog.init("phc_YOUR_PROJECT_KEY", {
    api_host: "https://us.i.posthog.com", // or eu.i.posthog.com, or self-hosted URL
    autocapture: false, // No automatic DOM event tracking — we control exactly what's sent
    capture_pageview: false, // SPA in Electron, manual pageviews
    capture_pageleave: false,
    disable_session_recording: true, // No session replay — this is a desktop app with sensitive code
    persistence: "localStorage",
    loaded: (ph) => {
      // Identify by GitHub username if available
      ipc("env.user", {})
        .then((user) => {
          if (user?.login) {
            ph.identify(user.login, {
              name: user.name ?? user.login,
            });
          }
        })
        .catch(() => {});
    },
  });

  initialized = true;
}

/**
 * Track a product event.
 *
 * Events are purely behavioral — what actions the user takes.
 * NEVER include code content, PR bodies, diff text, or file paths.
 */
export function track(event: string, properties?: Record<string, string | number | boolean>): void {
  if (!initialized) return;
  posthog.capture(event, properties);
}

/**
 * Track a view/page navigation.
 */
export function trackPage(view: string): void {
  if (!initialized) return;
  posthog.capture("$pageview", { $current_url: `dispatch://${view}` });
}

/**
 * Shut down PostHog (on app quit or opt-out).
 */
export function shutdownPostHog(): void {
  if (!initialized) return;
  posthog.shutdown();
  initialized = false;
}
```

**Events to track:**

Track only _actions_, never _content_. The goal is to understand which features are used and where users drop off.

| Event                   | Properties                                          | When                                               |
| ----------------------- | --------------------------------------------------- | -------------------------------------------------- |
| `app_opened`            | `version`                                           | App launch (after splash)                          |
| `pr_opened`             | `file_count`, `additions`, `deletions`              | User opens a PR in the detail view                 |
| `pr_approved`           | —                                                   | User approves a PR                                 |
| `pr_changes_requested`  | —                                                   | User requests changes                              |
| `pr_merged`             | `strategy` (squash/merge/rebase)                    | User merges a PR                                   |
| `comment_created`       | —                                                   | User creates an inline comment                     |
| `diff_search_used`      | —                                                   | User triggers Cmd+F in diff                        |
| `blame_viewed`          | —                                                   | Blame popover appears (debounced, max once per PR) |
| `ci_rerun`              | —                                                   | User re-runs a failed CI job                       |
| `ci_log_viewed`         | —                                                   | User expands a CI log viewer                       |
| `ci_annotation_seen`    | `level` (failure/warning/notice)                    | CI annotation renders in diff                      |
| `workflow_triggered`    | —                                                   | User triggers a workflow_dispatch run              |
| `run_comparison_used`   | —                                                   | User opens run comparison view                     |
| `ai_explanation_used`   | `provider`                                          | User triggers an AI code explanation               |
| `ai_summary_generated`  | `provider`                                          | AI review summary is generated                     |
| `ai_failure_explained`  | `provider`                                          | AI CI failure explanation triggered                |
| `review_round_toggled`  | `mode` (all/since-last)                             | User toggles review round mode                     |
| `workspace_switched`    | —                                                   | User switches workspace                            |
| `notification_received` | `type` (review/ci-fail/approve)                     | OS notification sent                               |
| `view_navigated`        | `view` (review/workflows/metrics/releases/settings) | Tab/view change                                    |

**NEVER track:** file paths, code content, PR titles, branch names, commit messages, comment bodies, usernames of PR authors/reviewers, or any GitHub data beyond aggregate counts.

**Integration points:**

**Modify:** `src/renderer/app.tsx`

```typescript
import { initPostHog } from "./lib/posthog";

// In the PostSplashApp component, after resolving "ready" phase:
useEffect(() => {
  initPostHog();
}, []);
```

**Modify:** `src/renderer/lib/router.tsx`

```typescript
import { trackPage } from "./posthog";

// In the navigate function:
function navigate(route: Route) {
  setRoute(route);
  trackPage(route.view);
}
```

**Modify individual components** — add `track()` calls at the action points listed above. Each is a single line addition:

```typescript
track("pr_approved");
```

#### Settings UI for Opt-In

**Modify:** `src/renderer/components/settings-view.tsx`

Add an "Analytics" section:

```
Analytics
  [ ] Send anonymous usage data to help improve Dispatch
  We track which features are used, not what you're reviewing.
  No code, file paths, or PR content is ever sent.
```

- Toggle: Calls `ipc("preferences.set", { key: "analytics-opted-in", value: checked ? "true" : "false" })`
- Default: **OFF** (opt-in, not opt-out)
- When toggled ON: Call `initPostHog()`
- When toggled OFF: Call `shutdownPostHog()`

### B2. Sentry Crash Reporting

**Install:**

```bash
bun add @sentry/electron
```

**Modify:** `src/main/index.ts`

```typescript
import * as Sentry from "@sentry/electron/main";

Sentry.init({
  dsn: "https://xxx@xxx.ingest.us.sentry.io/xxx",
  // Only send if user opted in (check preference synchronously from SQLite)
  enabled: getPreference("crash-reports-opted-in") === "true",
});
```

**Modify:** `src/renderer/main.tsx`

```typescript
import * as Sentry from "@sentry/electron/renderer";

Sentry.init({
  // Renderer Sentry auto-connects to the main process init
});
```

**What Sentry captures:** Stack traces, error messages, Electron version, OS version. **NOT:** code content, PR data, file paths, GitHub tokens.

**Settings toggle:** Add alongside the analytics toggle:

```
Crash Reports
  [ ] Send anonymous crash reports to help fix bugs
  Only error stack traces are sent. No code or personal data.
```

Default: **OFF**.

### B3. PostHog Feature Flags (Future Use)

PostHog's feature flags let us gate features remotely without shipping an update. This is useful for:

- Rolling out AI features to a subset of users
- A/B testing UI changes
- Disabling a broken feature without a hotfix

Don't implement this now — just be aware it's available in PostHog for free. When we need it:

```typescript
import posthog from "posthog-js";

if (posthog.isFeatureEnabled("ai-review-summary")) {
  // Show the AI summary component
}
```

---

## Part C: Testing & Quality

### C1. Component Tests

**Install:**

```bash
bun add -d @testing-library/react @testing-library/jest-dom jsdom
```

**Configure vitest** for component tests in `vite.config.ts`:

```typescript
test: {
  environment: "jsdom",
  setupFiles: ["./src/test-setup.ts"],
  include: ["src/**/*.{test,spec}.{ts,tsx}"],
}
```

**New file:** `src/test-setup.ts`

```typescript
import "@testing-library/jest-dom";

// Mock the IPC layer for component tests
vi.mock("./renderer/lib/ipc", () => ({
  ipc: vi.fn(),
}));
```

**Priority test targets:**

| Component                   | What to test                                                                              | File                             |
| --------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------- |
| `diff-parser.ts`            | Already has 431 lines of tests. Maintain.                                                 | `diff-parser.test.ts`            |
| `diff-viewer.tsx`           | Renders correct line counts, handles empty files, word-diff segments, hunk headers sticky | `diff-viewer.test.tsx`           |
| `pr-inbox.tsx`              | Renders PR items from mock IPC data, search filters correctly, size badge labels          | `pr-inbox.test.tsx`              |
| `checks-panel.tsx`          | Status icon color mapping, re-run calls correct IPC, expandable log toggle                | `checks-panel.test.tsx`          |
| `router.tsx`                | Navigates between views, `route.view` changes, back/forward (if applicable)               | `router.test.tsx`                |
| `notifications.ts`          | `sendNotification` calls Web Notification API with correct title/body/tag                 | `notifications.test.ts`          |
| `use-keyboard-shortcuts.ts` | Fires handler on key match, skips in inputs, respects modifiers and `when`                | `use-keyboard-shortcuts.test.ts` |

Each test file should mock the IPC layer (`vi.mock`) and provide fake data that matches the `ipc.ts` contract types.

### C2. Performance Benchmarks

**New file:** `src/renderer/lib/diff-parser.bench.ts`

```typescript
import { bench, describe } from "vitest";
import { parseDiff } from "./diff-parser";

// Generate a synthetic diff with N lines
function generateDiff(lineCount: number): string {
  let diff = "diff --git a/big-file.ts b/big-file.ts\n--- a/big-file.ts\n+++ b/big-file.ts\n";
  diff += `@@ -1,${lineCount} +1,${lineCount} @@\n`;
  for (let i = 0; i < lineCount; i++) {
    if (i % 5 === 0) diff += `+const added_${i} = true;\n`;
    else if (i % 7 === 0) diff += `-const removed_${i} = false;\n`;
    else diff += ` const context_${i} = null;\n`;
  }
  return diff;
}

describe("diff parser performance", () => {
  bench("parse 1,000 lines", () => {
    parseDiff(generateDiff(1000));
  });
  bench("parse 10,000 lines", () => {
    parseDiff(generateDiff(10000));
  });
  bench("parse 50,000 lines", () => {
    parseDiff(generateDiff(50000));
  });
});
```

Run with: `bun vitest bench`

This gives us a baseline for parser performance. When virtualization is implemented, add a render benchmark using React Testing Library's `render()` + scroll simulation.

### C3. CI Quality Pipeline

**New file:** `.github/workflows/ci.yml`

Runs on every push and PR:

```yaml
name: CI
on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run format:check
      - run: bun run typecheck
      - run: bun run test
      - run: bun run build
```

This ensures: lint passes, formatting is consistent, types check, tests pass, and the app builds. Gate PRs on this.

---

## Part D: Documentation & Polish

### D1. README.md

**New file:** `README.md` (replace any existing stub)

```markdown
# Dispatch

The CI/CD-integrated code review app for GitHub. Desktop-native. Keyboard-first.

![Dispatch screenshot](resources/screenshot.png)

## Features

- **PR inbox** with real-time polling across multiple repos
- **Diff viewer** with syntax highlighting, word-level diffs, and git blame on hover
- **CI annotations** inline at the exact line that caused a failure
- **Checks panel** with live status, log viewer, and one-click re-run
- **Workflows dashboard** with Gantt timelines, run comparison, and workflow triggers
- **AI-powered** code explanations, review summaries, and CI failure analysis
- **Team metrics** — cycle time, review load, PR size trends
- **Releases** with auto-generated changelogs
- **Desktop notifications** and system tray presence
- **Keyboard-first** — every action has a keybinding

## Requirements

- [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated
- [Git](https://git-scm.com/) installed
- A local clone of the repo(s) you want to review

## Install

### macOS (Homebrew)

\`\`\`
brew install dispatchdev/tap/dispatch
\`\`\`

### Download

See [Releases](https://github.com/dispatchdev/dispatch/releases) for macOS (DMG), Windows (installer), and Linux (AppImage).

## Development

\`\`\`bash
bun install
bun dev
\`\`\`

### Scripts

| Command                | Description                      |
| ---------------------- | -------------------------------- |
| `bun dev`              | Start dev server with hot reload |
| `bun run build`        | Build for production             |
| `bun run lint`         | Run oxlint                       |
| `bun run format:check` | Check formatting with oxfmt      |
| `bun run typecheck`    | TypeScript type check            |
| `bun run test`         | Run tests                        |

## Architecture

Dispatch is an Electron app with a React renderer. It uses the `gh` CLI as its primary data layer and local `git` for blame/history. All data stays on your machine.

See [MISSION.md](MISSION.md) for the full technical vision and architectural decisions.

## License

[MIT](LICENSE)
```

### D2. Keyboard Shortcuts Dialog

**New component:** `src/renderer/components/keyboard-shortcuts-dialog.tsx`

Triggered by pressing `?` (standard in keyboard-driven apps like GitHub, Gmail, Figma).

Shows a dialog/modal with all available shortcuts, organized by section:

```
Navigation                    Actions
  j / k    Prev / next PR      a        Approve PR
  Enter    Open PR              m        Merge PR
  [ / ]    Prev / next file     v        Toggle viewed
  Cmd+B    Toggle sidebar       n        Next unreviewed
                                c        Comment on line
Search
  /        Focus search        Views
  Cmd+F    Search in diff       1        Review
  Esc      Clear / close        2        Workflows
                                3        Metrics
                                ?        This dialog
```

**Styling:**

- Overlay: `var(--bg-overlay)`
- Dialog: `var(--bg-elevated)`, `var(--border-strong)`, `var(--radius-xl)`, `var(--shadow-lg)`
- Max width: 560px, centered
- Sections: Two-column grid
- Section headers: 10px uppercase label, `var(--text-tertiary)`
- Key: `<kbd>` styled per design system section 8.12
- Description: 12px, `var(--text-secondary)`
- Close: `Escape` key or click outside

**Register the `?` shortcut** in `app-layout.tsx` via `useKeyboardShortcuts`:

```typescript
{ key: "?", handler: () => setShowShortcuts(true) }
```

### D3. CONTRIBUTING.md (If Open-Sourcing)

```markdown
# Contributing to Dispatch

## Setup

1. Install [Bun](https://bun.sh)
2. Install [GitHub CLI](https://cli.github.com/) and run `gh auth login`
3. Clone the repo and run `bun install`
4. Run `bun dev` to start the development server

## Code Style

We use [oxlint](https://oxc.rs/docs/guide/usage/linter) for linting and [oxfmt](https://oxc.rs/docs/guide/usage/formatter) for formatting. Run `bun run lint:fix` and `bun run format` before committing.

## Testing

Run `bun run test` to run all tests. The diff parser has the most comprehensive test coverage — maintain it when changing parser logic.

## Architecture

- `src/main/` — Electron main process (IPC handlers, gh/git CLI adapters, SQLite)
- `src/renderer/` — React renderer (components, hooks, lib)
- `src/shared/` — Shared types and IPC contract
- `src/preload/` — Electron preload script (context bridge)

All GitHub data flows through the `gh` CLI. All local git data flows through the `git` CLI. The IPC contract in `src/shared/ipc.ts` defines every endpoint.

See [MISSION.md](MISSION.md) for design principles and continuation guidelines.
```

---

## New Files Summary

| Action | File                                                    | Description                                           |
| ------ | ------------------------------------------------------- | ----------------------------------------------------- |
| Create | `src/renderer/lib/posthog.ts`                           | PostHog initialization, event tracking, page tracking |
| Create | `src/renderer/components/update-banner.tsx`             | Auto-update notification banner                       |
| Create | `src/renderer/components/keyboard-shortcuts-dialog.tsx` | `?` key shortcut reference                            |
| Create | `build/entitlements.mac.plist`                          | macOS code signing entitlements                       |
| Create | `scripts/notarize.js`                                   | Apple notarization after-sign hook                    |
| Create | `.github/workflows/release.yml`                         | Cross-platform release build pipeline                 |
| Create | `.github/workflows/ci.yml`                              | Quality gate: lint, format, typecheck, test, build    |
| Create | `src/test-setup.ts`                                     | Test environment setup (jsdom, IPC mock)              |
| Create | `src/renderer/lib/diff-parser.bench.ts`                 | Performance benchmarks for diff parser                |
| Create | `README.md`                                             | Project README                                        |
| Create | `CONTRIBUTING.md`                                       | Contributor guide                                     |
| Modify | `src/main/index.ts`                                     | Sentry init, auto-updater, `app.restart` IPC          |
| Modify | `src/renderer/app.tsx`                                  | PostHog init on ready                                 |
| Modify | `src/renderer/lib/router.tsx`                           | Page tracking on navigate                             |
| Modify | `src/renderer/components/settings-view.tsx`             | Analytics + crash reporting opt-in toggles            |
| Modify | `src/renderer/components/app-layout.tsx`                | `?` shortcut registration                             |
| Modify | `package.json`                                          | `publish` config, new dependencies                    |

## Dependencies to Install

```bash
bun add posthog-js electron-updater @sentry/electron
bun add -d @electron/notarize @testing-library/react @testing-library/jest-dom jsdom
```

---

## Priority Order

1. **CI quality pipeline** (`.github/workflows/ci.yml`) — gate every PR on lint+type+test+build
2. **PostHog + Sentry** — start collecting data and catching crashes immediately
3. **Component tests** — safety net before distributing to real users
4. **Code signing + notarization** — required for distribution
5. **Auto-update + update banner** — users won't manually re-download
6. **Release CI pipeline** — automates signing + publishing
7. **Keyboard shortcuts dialog** — quick polish win
8. **README + CONTRIBUTING** — needed before any external visibility
9. **Homebrew cask** — after first stable release
10. **Performance benchmarks** — ongoing, run in CI

## What's Deferred (Intentionally)

| Item                     | Reason                                                                                                           | When                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Browser extension        | Need users first. Extension drives adoption from GitHub, but only useful once the app is stable and distributed. | Phase 5                       |
| Website / landing page   | Need a downloadable build first. No point marketing what people can't install.                                   | Phase 5                       |
| Monetization / licensing | Need users before revenue. Free tier should be generous to drive adoption.                                       | Phase 5+                      |
| Session replay (PostHog) | Disabled — desktop app with sensitive code on screen. Too risky for trust.                                       | Never (or heavily restricted) |
