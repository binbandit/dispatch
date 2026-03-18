# AI Implementation Specification: Dispatch (CI/CD-Integrated Desktop PR Review App)

## 1. System Overview

Build a desktop application for software engineers to review GitHub Pull Requests, diagnose CI/CD failures, and merge code—without leaving the app.

The core architectural differentiator is that this is a **local-first Desktop App**. It does not have a proprietary cloud backend. It relies entirely on the user's local `git` installation and the official GitHub CLI (`gh`) for authentication, data fetching, and actions.

**Do NOT build:** User authentication flows, backend databases, API servers, or cloud syncing.

### Required Reading

Before implementing any UI described in this spec, you **MUST** read [`DISPATCH-DESIGN-SYSTEM.md`](./DISPATCH-DESIGN-SYSTEM.md). It is the authoritative source for every color, font, spacing value, radius, shadow, animation, and component pattern. All UI work must conform to that document — no improvisation, no generic defaults. See also [`dispatch-design-reference.html`](./dispatch-design-reference.html) for a living visual reference.

## 2. Tech Stack & Architecture

- **Application Shell:** Electron
- **Frontend (Renderer):** React 19, Tailwind CSS v4, Vite
- **State Management/Routing:** React Query (for polling/caching `gh` responses), minimal client-side routing.
- **Communication:** Typed IPC (direct `ipcMain.handle` / `ipcRenderer.invoke` with shared type contract in `src/shared/ipc.ts`)
- **Local Storage (Main Process):** SQLite (better-sqlite3) for caching PR states, user preferences, and tracking the last-reviewed SHA for diff comparisons.
- **Data Layer (Main Process):**
  - `gh` CLI adapter (executing child processes for `gh api` and `gh pr` commands).
  - `git` CLI adapter (executing child processes for local `git blame`, `git log`, `git diff`).
- **UI Components:** Virtualized lists (e.g., `@tanstack/react-virtual`), Shiki WASM for GPU-accelerated syntax highlighting.

### Architecture Rules for AI

1. **Renderer Process:** Pure UI. No direct Node.js APIs. It requests data via typed IPC (`ipc()` function).
2. **Main Process:** The only place where `child_process.exec`, file system reads, and SQLite queries occur.
3. **Authentication:** Assume the user has run `gh auth login` on their machine. Use the existing system keychain/auth token. Do not build login screens.

---

## 3. Phase 1 (MVP) Core Feature Specifications

### 3.1. PR Inbox

- **UI:** Keyboard-navigable list (vim bindings: `j`/`k`) of PRs needing review or authored by the user.
- **Data Source:** Polled via `gh pr list --json title,author,reviewDecision,statusCheckRollup,updatedAt` (run every 30s).
- **Storage:** Cache results in local SQLite to enable instant load on app start.

### 3.2. The Diff Viewer (Critical Path)

- **Layout:** Two-pane view. Left sidebar for the file tree; main area for the diff.
- **Performance:** The diff view MUST use a virtualized DOM. We must support 50,000-line files smoothly.
- **Local Git Integrations (The Moat):**
  - _Blame on Hover:_ When a user hovers over a line, the Main process runs `git blame -L <line>,<line> <commit> -- <file>` on the local clone and returns the author/commit msg.
  - _File History:_ Right-clicking a file triggers `git log --follow <path>`.
- **Review Rounds (Incremental Diff):**
  - _Logic:_ When a user finishes reviewing a PR, save the current HEAD SHA of the PR branch to SQLite.
  - _Next Visit:_ If the PR has new commits, compute the diff _only_ between the saved SHA and the new HEAD using local `git diff <saved_sha> <new_head>`.
- **State:** Store "Viewed" checkbox status per file in SQLite.

### 3.3. CI/CD Panel

- **UI:** An integrated panel showing GitHub Actions status, mapped directly to the code where possible.
- **Data Source:** `gh pr checks --json` and `gh run view --json`.
- **Log Viewer:** Fetch logs via `gh run view --log`. Parse ANSI color codes to HTML for terminal-like display in the UI. Allow `Cmd+F` text search within logs.
- **Actions:**
  - Provide a "Re-run failed jobs" button executing `gh run rerun <id> --failed`.
  - _Crucial Feature:_ Parse log outputs for `::error file=X,line=Y::` syntax and pass these to the Renderer to draw red squiggly lines directly inside the Diff Viewer.

### 3.4. Merge & Ship

- **UI:** A pre-merge checklist modal verifying required reviews and green CI.
- **Action:** Execute `gh pr merge --<strategy> --delete-branch` upon user confirmation.

---

## 4. Strict Constraints & Anti-Goals

**When building this application, you MUST adhere to the following negative constraints. Do NOT write code for these features:**

1. **No Git Hosting/Servers:** We do not host code. Do not implement REST endpoints or Express servers.
2. **No Code Editing:** Do not build a code editor. No saving files. The diff viewer is strictly read-only + inline commenting.
3. **No OAuth/Token Management:** Do not build "Sign in with GitHub." The app will throw an error screen if `gh` is not installed or authenticated globally, prompting the user to run `gh auth login` in their terminal.
4. **No Merge Queues:** Do not attempt to manage stacking or queued merges. We strictly execute the merge command; if the repo uses a queue, GitHub handles it.
5. **No Web Build:** Ignore Webpack/Vite configurations for a browser-based web app. Focus purely on the Electron build pipeline.

---

## 5. Development Bootstrapping Instructions

**To the AI Agent:** Begin by initializing the project with the following exact steps.

1. Initialize a standard Electron + Vite + React + TypeScript boilerplate.
2. Install Tailwind CSS v4 and configure the Vite plugin.
3. Set up typed IPC bridge connecting `ipcMain.handle` to `ipcRenderer.invoke` with shared type contract.
4. Create a utility service in the Main process called `GhCliService.ts` that uses Node's `child_process.exec` to run `gh --version` to verify the environment.
5. Pause and output the directory structure and the `GhCliService.ts` code for human review.
