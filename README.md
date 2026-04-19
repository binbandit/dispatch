# Dispatch

Dispatch is a local GitHub review workstation built with Electron. It pulls together pull request triage, review, workflow inspection, release tracking, merge-queue awareness, and repo-level review tooling in one desktop app.

It runs entirely on your machine and talks to GitHub through the `gh` CLI plus your local `git` install. There is no backend service and no separate SaaS dependency. Local state is cached in SQLite, and optional analytics are forwarded from the app to PostHog only when enabled in settings.

## What the app does today

- Review inbox for pull requests across configured workspaces
- Repository onboarding by GitHub search or by linking a local folder
- PR detail view with diff navigation, inline comments, side panels, and review actions
- Review round tracking so you can focus on changes since your last pass
- AI-assisted review surfaces for summaries, triage, explanations, comment suggestions, and rewrite helpers
- Workflow dashboard with run history, run detail, reruns, cancellation, and run comparison
- Release management with release history and in-app release creation
- Metrics view for cycle time, review load, throughput, and PR size distribution
- Merge queue view for repositories that use GitHub merge queues
- Notification center for review requests, CI failures, approvals, and merges
- System tray integration with live review counts and quick-open actions
- Multi-account GitHub support with per-repo account memory
- Multi-workspace support with workspace switching in the app shell
- Settings for theme, code theme, keybindings, merge defaults, bot handling, privacy, and AI provider configuration

## How it works

Dispatch is split across Electron's standard runtime boundaries:

- `src/main`: privileged Electron and Node code for `gh`, `git`, SQLite, filesystem access, notifications, and OS integration
- `src/preload`: typed `contextBridge` surface exposed to the renderer
- `src/renderer`: the React app
- `src/shared`: shared contracts and pure utilities

Key architectural details live in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Stack

| Layer           | Tool                                                       |
| --------------- | ---------------------------------------------------------- |
| Runtime         | Electron 41                                                |
| App tooling     | Vite Plus + `vite-plugin-electron`                         |
| UI              | React 19                                                   |
| Component base  | Owned `src/components/ui` wrappers around `@base-ui/react` |
| Styling         | Tailwind CSS 4                                             |
| State/data      | TanStack Query 5, Zustand 5                                |
| Persistence     | SQLite via `better-sqlite3`                                |
| Language        | TypeScript 5.9                                             |
| Testing         | `vp test` (Vitest-compatible)                              |
| Quality         | `vp check`, `vp lint`, `vp fmt`                            |
| Package manager | Bun                                                        |

## Requirements

- [Bun](https://bun.sh)
- [Git](https://git-scm.com)
- [GitHub CLI (`gh`)](https://cli.github.com) installed and available on your `PATH`
- GitHub CLI authentication completed with `gh auth login`

Dispatch depends on the GitHub CLI for GitHub access. The app will not work unless `gh` is installed and you are already signed in locally.

You can verify your setup with:

```sh
gh --version
gh auth status
```

Local repository folders are optional, but linking a local clone enables git-backed features and better local context. You can also add remote-only repositories from inside the app.

## Getting started

```sh
gh auth login
bun install
bun run dev
```

## User guides

- [Review Page Keyboard Navigation](./REVIEW-KEYBOARD-NAVIGATION.md)

On first launch, Dispatch checks for `git`, `gh`, and GitHub CLI authentication. If `gh` is missing or not logged in, GitHub-powered features will stay unavailable until that is fixed. If no workspaces are configured yet, the app walks you through adding a repository.

## Scripts

| Command                 | Purpose                                            |
| ----------------------- | -------------------------------------------------- |
| `bun run check`         | Run the consolidated Vite Plus project checks      |
| `bun run check:fix`     | Run checks with auto-fixes where supported         |
| `bun run dev`           | Start the Vite Plus dev server and launch Electron |
| `bun run build`         | Build the renderer and Electron bundles            |
| `bun run build:app`     | Package the app for distribution                   |
| `bun run build:app:dir` | Build an unpacked distribution directory           |
| `bun run build:app:dmg` | Build a macOS DMG and ZIP                          |
| `bun run preview`       | Preview the Vite build                             |
| `bun run test`          | Run tests once                                     |
| `bun run test:watch`    | Run tests in watch mode                            |
| `bun run lint`          | Run `vp lint`                                      |
| `bun run lint:fix`      | Run `vp lint --fix`                                |
| `bun run format`        | Run `vp fmt --write .`                             |
| `bun run format:check`  | Run `vp fmt --check .`                             |
| `bun run typecheck`     | Run TypeScript type checking                       |

## Packaging

Packaged builds are produced with Electron Builder and written to `release/`.

Current configured targets:

- macOS: `zip` by default, plus `dmg` via `bun run build:app:dmg`
- Windows: `nsis`
- Linux: `AppImage`, `deb`

## Project structure

```text
src/
  main/                  Electron main process
    db/                  SQLite schema, migrations, and persistence helpers
    ipc-handlers/        Domain IPC handler modules
    services/            Main-process services, including GitHub CLI adapters
  preload/               Typed Electron bridge
  renderer/              React application
    components/          Feature-grouped UI
    hooks/               Renderer hooks grouped by domain
    lib/                 Renderer utilities grouped by responsibility
  shared/                Shared types and pure utilities
  components/ui/         Owned UI primitives
scripts/                 Packaging, notarization, and release/version helpers
resources/               App and tray assets
```

Renderer feature areas currently include:

- `shell`
- `setup`
- `settings`
- `inbox`
- `review`
- `workflows`
- `shared`

## Development notes

- Use Bun for install and script execution
- Keep renderer code in feature folders rather than flat shared buckets
- Add cross-process features by defining the shared contract first, then main handler, preload exposure, and renderer usage
- UI work should follow the design system in `DISPATCH-DESIGN-SYSTEM.md`
