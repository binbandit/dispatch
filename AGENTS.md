# Dispatch — Agent Instructions

> Local GitHub review workstation. Electron + React + Tailwind CSS + Vite Plus.

## Global Policy

Before making code changes, read `/Users/brayden/.agents/policy.md`.
That file defines the machine-wide baseline coding policy and applies here in
addition to this project file. If the two documents conflict, this project file
takes precedence for repo-specific decisions.

## Required Reading

**Before writing any UI code, you MUST read `DISPATCH-DESIGN-SYSTEM.md` in the project root.** It is the authoritative specification for every color, font, spacing value, radius, shadow, animation, and component pattern used in this application. Do not improvise or use generic defaults. Every visual decision must trace back to that document.

**Before doing a large refactor or deciding where new files should live, read `ARCHITECTURE.md` in the project root.** It is the authoritative map for current module boundaries, feature folders, IPC contracts, and main-process service splits.

Key things defined there that you must follow:

- **Color system**: Warm undertones only. Background is `#08080a`, not neutral gray. Accent is copper `#d4883a`, not blue.
- **Typography**: DM Sans for UI, JetBrains Mono for code/paths/timestamps, Instrument Serif (italic) for display headings. Never use Inter, Roboto, or system defaults as primary.
- **Spacing**: 4px base grid. Dense, not cramped.
- **Borders**: Warm-tinted (`#25231f`), not neutral gray.
- **Radius**: 2-12px range. Not brutalist (0px), not bubbly (16px+).
- **Shadows**: Higher opacity than typical (0.3), visible on dark backgrounds.
- **Icons**: Lucide React, specific sizes per context (see Section 9).

Also see `dispatch-design-reference.html` for a living visual reference.

---

## Tech Stack

| Layer           | Tool                                                       | Version |
| --------------- | ---------------------------------------------------------- | ------- |
| Runtime         | Electron                                                   | 41      |
| App tooling     | Vite Plus (`vite-plus`, `vp`) + `vite-plugin-electron`     | latest  |
| UI Framework    | React                                                      | 19      |
| UI primitives   | Owned `src/components/ui` wrappers around `@base-ui/react` | latest  |
| Styling         | Tailwind CSS + `tw-animate-css`                            | 4       |
| State/data      | TanStack Query, Zustand                                    | 5       |
| Persistence     | SQLite via `better-sqlite3`                                | latest  |
| Language        | TypeScript                                                 | 5.9     |
| Testing         | `vp test` (Vitest-compatible)                              | latest  |
| Quality         | `vp check`, `vp lint`, `vp fmt`                            | latest  |
| Package manager | Bun                                                        | latest  |

## Project Structure

```
src/
  main/                  Electron main process (Node.js context)
    db/                  SQLite schema, migrations, and persisted app/review state
    ipc-handlers/        Domain IPC handler modules
    services/            Main-process services (`gh-cli/`, git, AI, tray, analytics, shell)
  preload/               Preload scripts (contextBridge)
  renderer/              Vite-served renderer (browser context)
    components/          Feature-grouped UI (`shell`, `setup`, `settings`, `inbox`, `review`, `workflows`, `shared`)
    hooks/               Renderer hooks grouped by domain (`ai`, `app`, `preferences`, `review`)
    lib/                 Renderer utilities grouped by responsibility (`app`, `inbox`, `keyboard`, `review`, `shared`)
  shared/                Cross-process types, pure utilities, and IPC contracts
    ipc/contracts/       Typed IPC contracts grouped by domain
  components/ui/         Owned UI primitives layered over `@base-ui/react`
  hooks/                 Shared hooks outside renderer feature folders
  lib/                   Shared utilities (`cn`, etc.)
scripts/                 Packaging, notarization, and release/version helpers
resources/               App, tray, dock, and packaging assets
```

Placement rules:

- Put new renderer code in the narrowest feature folder that matches the product area. Do not add new flat catch-all files back under `src/renderer/components`, `src/renderer/hooks`, or `src/renderer/lib`.
- When a screen grows too large, split it into a composition file plus sibling part files instead of keeping rows, tabs, dialogs, and helpers inline.
- Add new IPC methods in this order: `src/shared/ipc/contracts/*`, then `src/main/ipc-handlers/*`, then preload exposure, then renderer usage.
- Workspace and repo discovery methods currently live in `src/shared/ipc/contracts/environment.ts`; keep related methods there unless you are intentionally extracting a clearer public contract.
- Persistence changes usually touch both `src/main/db/database.ts` and `src/main/db/repository.ts`.

## Current Product Areas

- `review`: inbox/home, PR detail, diff navigation, comments, side panels, merge/review actions, and AI review surfaces
- `workflows`: workflow dashboard, run detail, logs, job graphs, run comparison, and releases
- `inbox`: home sections, command palette, search/autocomplete, metrics, and merge queue
- `shell`: navbar, notification center, splash screen, update banner, and keyboard shortcuts
- `setup` and `settings`: environment checks, onboarding, theme/code-theme preferences, AI provider configuration, keybindings, and experimental flags

## Commands

Use `bun run <script>` for everything.

| Script          | Command                 | Purpose                                                |
| --------------- | ----------------------- | ------------------------------------------------------ |
| `check`         | `bun run check`         | Run the consolidated Vite Plus project checks          |
| `check:fix`     | `bun run check:fix`     | Run checks with auto-fixes where supported             |
| `dev`           | `bun run dev`           | Start the Vite Plus dev server and Electron with HMR   |
| `build`         | `bun run build`         | Build renderer and Electron bundles                    |
| `build:app`     | `bun run build:app`     | Package the app with Electron Builder                  |
| `build:app:dir` | `bun run build:app:dir` | Build an unpacked distribution directory               |
| `build:app:dmg` | `bun run build:app:dmg` | Build a macOS DMG and ZIP                              |
| `preview`       | `bun run preview`       | Preview the renderer build                             |
| `test`          | `bun run test`          | Run tests once                                         |
| `test:watch`    | `bun run test:watch`    | Run tests in watch mode                                |
| `lint`          | `bun run lint`          | Run `vp lint` using the lint rules in `vite.config.ts` |
| `lint:fix`      | `bun run lint:fix`      | Run `vp lint --fix`                                    |
| `format`        | `bun run format`        | Run `vp fmt --write .`                                 |
| `format:check`  | `bun run format:check`  | Run `vp fmt --check .`                                 |
| `typecheck`     | `bun run typecheck`     | Run TypeScript type checking                           |

## React Patterns

- **Avoid `useEffect`**. Most uses of `useEffect` can be replaced with better patterns:
  - **Derived state**: If you're syncing state in an effect (e.g. clamping an index when a list shrinks), compute it inline during render instead.
  - **Event handlers**: If an effect runs in response to a user action, move the logic into the event handler that triggered the change.
  - **Ref callbacks**: If an effect focuses/measures a DOM node on mount, use a ref callback (`ref={(node) => { ... }}`) instead.
  - **`autoFocus`**: If an effect just calls `.focus()` on mount, use the `autoFocus` HTML attribute.
  - **Render-time notifications**: If an effect notifies a parent of derived state changes, use a ref to track the previous value and call the callback conditionally during render.
- Legitimate uses of `useEffect` that should stay: subscribing to external events (IPC, DOM listeners), timers/intervals, async initialization, and scroll-into-view triggered by state changes.
- React 19 patterns already used in the app include `useEffectEvent`, `useDeferredValue`, and `startTransition`; prefer them when they make interaction-heavy code clearer.
- Use `useMemo` and `useCallback` when they materially reduce repeated work or stabilize props across heavy subtrees, not as automatic boilerplate.

## Code Standards

- **Formatting**: `bun run format` uses the `vp fmt` configuration in `vite.config.ts`. Do not manually adjust whitespace, quotes, semicolons, trailing commas, or import ordering after the formatter runs.
- **Linting**: `bun run lint` uses the `vp lint` configuration in `vite.config.ts` with import, TypeScript, unicorn, and vitest rules. Treat warnings as must-fix for committed work.
- **Imports**: `vp fmt` sorts imports. Type imports go first, then builtins, then externals, then internal, then relative.
- **Types**: Use `type` keyword for type-only imports. Strict mode is on. No `any` unless unavoidable (and explain why).
- **Testing**: Co-locate test files next to source (`foo.ts` → `foo.test.ts`). Use `describe`/`it`/`expect` from `vitest`.
- **File naming**: `kebab-case` for all files (enforced by lint).
- **Semicolons**: Yes. Double quotes. Trailing commas everywhere.

## Electron Architecture

- **Main process** (`src/main/`): Node.js context. Has full OS access. Owns window creation, tray/menu integration, SQLite, `gh`/`git` access, notifications, analytics forwarding, and IPC handlers.
- **Preload** (`src/preload/`): Bridge between main and renderer. Exposes a typed `window.api` object via `contextBridge`. Keep this surface minimal.
- **Renderer** (`src/renderer/`): Browser context. No direct Node.js access. Uses `window.api` for IPC. All UI lives here.
- **Context isolation**: Enabled. **Node integration**: Disabled. **Sandbox**: Enabled. Do not weaken these.

## Package Manager

Use **Bun** exclusively:

- `bun install` — not npm/yarn/pnpm
- `bun add <pkg>` / `bun add -d <pkg>` — add dependencies
- `bun run <script>` — run package.json scripts
- `bunx <pkg>` — instead of npx
