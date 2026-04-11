# Dispatch

Dispatch is an Electron desktop app for triaging GitHub pull requests, reviewing code, inspecting workflow runs, tracking release activity, and managing review work from one place.

It runs locally on your machine and talks to GitHub through the `gh` CLI plus your local `git` install. There is no backend service and no separate SaaS dependency.

## What the app does today

- Review inbox for pull requests across configured workspaces
- Repository onboarding by GitHub search or by linking a local folder
- PR detail view with diff navigation, inline comments, side panels, and review actions
- Review round tracking so you can focus on changes since your last pass
- Workflow dashboard with run history, run detail, reruns, cancellation, and run comparison
- Release management with release history and in-app release creation
- Metrics view for cycle time, review load, throughput, and PR size distribution
- Notification center for review requests, CI failures, approvals, and merges
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

| Layer           | Tool              |
| --------------- | ----------------- |
| Runtime         | Electron 41       |
| Bundler         | Vite 8            |
| UI              | React 19          |
| Component base  | coss ui / Base UI |
| Styling         | Tailwind CSS 4    |
| Language        | TypeScript 5.9    |
| Testing         | Vitest 4          |
| Linting         | oxlint            |
| Formatting      | oxfmt             |
| Package manager | Bun               |

## Requirements

- [Bun](https://bun.sh)
- [Git](https://git-scm.com)
- [GitHub CLI](https://cli.github.com)
- GitHub CLI authentication via `gh auth login`

Local repository folders are optional, but linking a local clone enables git-backed features and better local context. You can also add remote-only repositories from inside the app.

## Getting started

```sh
bun install
bun run dev
```

On first launch, Dispatch checks for `git`, `gh`, and GitHub CLI authentication. If no workspaces are configured yet, the app walks you through adding a repository.

## Scripts

| Command                 | Purpose                                       |
| ----------------------- | --------------------------------------------- |
| `bun run dev`           | Start the Vite dev server and launch Electron |
| `bun run build`         | Build the renderer and Electron bundles       |
| `bun run build:app`     | Package the app for distribution              |
| `bun run build:app:dir` | Build an unpacked distribution directory      |
| `bun run build:app:dmg` | Build a macOS DMG and ZIP                     |
| `bun run preview`       | Preview the Vite build                        |
| `bun run test`          | Run tests once                                |
| `bun run test:watch`    | Run tests in watch mode                       |
| `bun run lint`          | Run oxlint                                    |
| `bun run lint:fix`      | Run oxlint with fixes                         |
| `bun run format`        | Format the repo with oxfmt                    |
| `bun run format:check`  | Check formatting without writing              |
| `bun run typecheck`     | Run TypeScript type checking                  |

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
    ipc-handlers/        Domain IPC handler modules
    services/            Main-process services, including GitHub CLI adapters
  preload/               Typed Electron bridge
  renderer/              React application
    components/          Feature-grouped UI
    hooks/               Renderer hooks grouped by domain
    lib/                 Renderer utilities grouped by responsibility
  shared/                Shared types and pure utilities
  components/ui/         Owned UI primitives
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
