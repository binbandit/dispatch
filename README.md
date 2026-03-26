# Dispatch

A desktop app for reviewing GitHub pull requests, diagnosing CI/CD failures, and merging code — without leaving the app.

Dispatch talks to GitHub through the `gh` CLI and your local `git` install. No servers, no OAuth dance, no SaaS contract. Your machine is the compute.

## Why

AI coding agents generate more code than humans now. The bottleneck isn't writing code — it's reviewing, verifying, and shipping it. But the PR lifecycle is still fragmented across GitHub tabs, CI dashboards, and deployment UIs.

Dispatch unifies code review, CI/CD, and deployment into a single keyboard-driven surface.

## Features

- **PR Inbox** — Keyboard-navigable list of PRs needing review. Vim-style `j`/`k` navigation. Polls every 30s, cached in local SQLite for instant startup.
- **Diff Viewer** — Virtualized rendering for large files. Syntax highlighting via Shiki. File tree sidebar, inline commenting, viewed-file tracking.
- **Blame on Hover** — Runs `git blame` on your local clone. No server roundtrip. Shows author and commit message inline.
- **Review Rounds** — Tracks the last SHA you reviewed per PR. On your next visit, shows only what changed since then.
- **CI/CD Panel** — GitHub Actions status mapped to code. ANSI-rendered log viewer with search. Re-run failed jobs without leaving the app. CI error annotations drawn directly in the diff.
- **Merge & Ship** — Pre-merge checklist, then `gh pr merge` with your chosen strategy. One-click.
- **Triage View** — Classify and prioritize incoming PRs.
- **Notifications** — Native system notifications with dock badge counts (macOS).
- **Command Palette** — `Cmd+K` to jump anywhere.
- **AI Review Summaries** — Optional AI-powered PR summaries and explanations.

## Architecture

Electron desktop app. No backend server.

```
src/
  main/            Electron main process — gh/git CLI adapters, SQLite, IPC handlers
  preload/         Typed contextBridge (window.api)
  renderer/        React UI — Vite-served, browser context
  shared/          Pure utilities shared across processes
```

- **Main process** shells out to `gh` and `git` via child processes. Caches data in SQLite (`better-sqlite3`).
- **Renderer** is a standard React app. Communicates with main via typed IPC. No direct Node.js access.
- Context isolation enabled, node integration disabled, sandbox enabled.

## Tech Stack

| Layer      | Tool                                      |
| ---------- | ----------------------------------------- |
| Runtime    | Electron 41                               |
| Bundler    | Vite 8                                    |
| UI         | React 19                                  |
| Styling    | Tailwind CSS 4                            |
| Language   | TypeScript 5.9                            |
| Testing    | Vitest                                    |
| Linting    | oxlint                                    |
| Formatting | oxfmt                                     |
| Icons      | Lucide React                              |
| Fonts      | DM Sans, JetBrains Mono, Instrument Serif |

## Prerequisites

- [Bun](https://bun.sh) (package manager and script runner)
- [GitHub CLI](https://cli.github.com) (`gh`) — authenticated via `gh auth login`
- A local clone of the repo(s) you want to review (needed for blame and file history; gracefully degrades without it)

## Getting Started

```sh
bun install
bun run dev
```

This starts the Vite dev server and launches Electron with hot module replacement.

## Scripts

| Command              | What it does                              |
| -------------------- | ----------------------------------------- |
| `bun run dev`        | Dev server + Electron with HMR            |
| `bun run build`      | Production build                          |
| `bun run build:app`  | Package the Electron app for distribution |
| `bun run test`       | Run tests once                            |
| `bun run test:watch` | Run tests in watch mode                   |
| `bun run lint`       | Lint with oxlint                          |
| `bun run lint:fix`   | Lint and auto-fix                         |
| `bun run format`     | Format with oxfmt                         |
| `bun run typecheck`  | TypeScript type checking                  |

## Building for Distribution

```sh
bun run build:app
```

Outputs to `release/`. Targets macOS (dmg, zip), Windows (nsis), and Linux (AppImage, deb).
