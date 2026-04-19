# Dispatch Architecture

Dispatch is an Electron application with three hard runtime boundaries:

- `src/main`: privileged Node/Electron code. This is the only layer that talks to `gh`, `git`, SQLite, the filesystem, or the operating system.
- `src/preload`: the typed bridge between Electron and the renderer. Keep the `window.api` surface small and explicit.
- `src/renderer`: React UI running in the browser context. No direct Node access.

`src/shared` holds types and pure utilities that can be imported safely from either side.

## Design Rules

- Keep process boundaries obvious. Renderer code should ask for capabilities through typed IPC rather than reaching into Electron-specific details.
- Prefer domain modules over catch-all files. If a file starts owning multiple product areas, split it.
- Keep the `gh` adapter explicit. It is acceptable for service modules to look like thin command maps if that keeps GitHub behavior auditable.
- Put shared types in `src/shared`, not in renderer or main-only folders.
- Favour stable public surfaces. Internal files can move, but imports used across the app should stay small and predictable.

## Current Module Shape

### Main Process

`src/main/index.ts` is the Electron bootstrap. It owns BrowserWindow creation, menus, tray setup, media-auth request headers for GitHub-hosted assets, database startup, badge plumbing, and global shortcuts.

`src/main/ipc-handler.ts` is the registration entrypoint only. Domain implementations live in:

- `src/main/ipc-handlers/app.ts`
- `src/main/ipc-handlers/environment.ts`
- `src/main/ipc-handlers/workspace.ts`
- `src/main/ipc-handlers/pull-requests.ts`
- `src/main/ipc-handlers/git.ts`
- `src/main/ipc-handlers/workflows.ts`
- `src/main/ipc-handlers/review.ts`
- `src/main/ipc-handlers/insights.ts`
- `src/main/ipc-handlers/ai.ts`
- `src/main/ipc-handlers/notifications.ts`

`src/main/services/gh-cli.ts` is the stable public entrypoint for GitHub CLI work. Internal responsibilities are split into:

- `src/main/services/gh-cli/core.ts`: execution, caching, repo resolution, shared helpers
- `src/main/services/gh-cli/prs.ts`: pull requests, comments, labels, reactions, merges
- `src/main/services/gh-cli/workflows.ts`: checks, workflow runs, logs, reruns
- `src/main/services/gh-cli/insights.ts`: cross-workspace aggregation, metrics, releases

When adding new GitHub behavior, put it in the narrowest module that matches the domain. Only move shared primitives into `core.ts`.

Other main-process services worth preserving as narrow modules:

- `src/main/services/git-cli.ts`: local git commands and repository inspection
- `src/main/services/ai*.ts`: provider discovery, config resolution, and AI task execution
- `src/main/services/tray-poller.ts`: background polling for tray state
- `src/main/services/notifications.ts`: desktop notification behavior
- `src/main/services/analytics.ts`: forwards opt-in-safe events to the renderer
- `src/main/services/external-links.ts` and `src/main/services/shell.ts`: controlled OS and child-process interaction

### Persistence

`src/main/db` is part of the main-process layer and owns all local persistence:

- `src/main/db/database.ts`: SQLite connection lifecycle, schema creation, and migrations
- `src/main/db/repository.ts`: read/write helpers for preferences, workspaces, PR caches, review state, AI caches, notifications, and resume state
- `src/main/db/workspace-state.ts`: shared helpers for pruning stale local workspace paths while keeping remote-only workspaces valid

### Shared IPC

`src/shared/ipc.ts` owns shared types, channel constants, and the composed `IpcApi` type. Method contracts are split under `src/shared/ipc/contracts/`:

- `app.ts`
- `environment.ts`
- `pull-requests.ts`
- `git.ts`
- `workflows.ts`
- `review.ts`
- `insights.ts`
- `ai.ts`
- `notifications.ts`

`src/shared/ipc/contracts/environment.ts` also currently owns `repo.*` and `workspace.*` methods. Keep related environment/workspace discovery APIs there unless you are intentionally extracting a clearer public contract.

Add new methods to the relevant contract file first, then implement the matching handler in `src/main/ipc-handlers/`, then expose it from preload if the renderer needs it.

### Renderer

Renderer components are grouped by feature under `src/renderer/components/`:

- `shell/`: app chrome, splash screen, navbar, update banner, notification center, keyboard shortcuts
- `setup/`: onboarding and environment checks
- `settings/`: preferences, AI config, code theme settings, experimental flags, and keybinding capture
- `inbox/`: review home, command palette, search surfaces, metrics, and merge queue views
- `review/`: PR detail, diff, comments, AI review UI, merge actions, and side-panel flows
- `workflows/`: workflow dashboards, run detail, job graphs, logs, comparisons, and releases
- `shared/`: renderer-only shared building blocks reused across features

Some larger features have another level of grouping inside them. For example, `review/` is split into:

- `ai/`: AI summaries, explanations, and suggestion UI
- `comments/`: comment threads, reactions, composers, and review events
- `diff/`: diff rendering, annotations, blame, and tree navigation
- `actions/`: merge and review action controls
- `sidebar/`: review sidebar-specific panes

Feature folders can also use sibling part files when a screen is still a single product surface but has too many inline leaf sections. Current examples:

- `src/renderer/components/settings/settings-view.tsx` with `settings-ai-parts.tsx`, `settings-code-theme.tsx`, and `bot-settings.tsx`
- `src/renderer/components/inbox/command-palette.tsx` with `command-palette-groups.tsx`

Renderer utilities are also grouped by responsibility:

- `src/renderer/lib/app/`: IPC client, router, query client, theme/workspace contexts, notifications, analytics
- `src/renderer/lib/keyboard/`: keybinding registry and provider
- `src/renderer/lib/inbox/`: inbox, home dashboard, search, and command-surface data shaping
- `src/renderer/lib/review/`: diff parsing, highlighting, merge strategy, activity/check summaries, triage helpers
- `src/renderer/lib/shared/`: small renderer-only utilities reused across features

Renderer hooks follow the same pattern:

- `src/renderer/hooks/ai/`
- `src/renderer/hooks/app/`
- `src/renderer/hooks/preferences/`
- `src/renderer/hooks/review/`

New renderer code should follow these rules:

- put feature-specific components next to the feature instead of adding more files to a flat shared folder
- split large screens into a composition file plus smaller sibling modules when a screen starts owning rows, tabs, badges, or dialogs inline
- keep shared UI primitives in `src/components/ui`
- keep shared renderer contexts and utilities in grouped `src/renderer/lib/*` buckets rather than recreating new flat utility folders

## Change Workflow

When you add a capability that crosses layers, use this order:

1. Define or extend shared types in `src/shared`.
2. Add the IPC contract in the relevant `src/shared/ipc/contracts/*` file.
3. Implement the main-process handler in the matching `src/main/ipc-handlers/*` module.
4. Add or extend the underlying service module in `src/main/services`.
5. If the feature persists local state, update `src/main/db/database.ts` and `src/main/db/repository.ts`.
6. Expose the typed method through preload.
7. Consume it from the renderer.

This keeps the public contract ahead of implementation and avoids invisible cross-process coupling.
