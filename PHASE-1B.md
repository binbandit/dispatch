# Phase 1B: Wire the UI to Real Data + Build the Core Components

## Context

The backend is 100% done. All 16 tRPC endpoints work. The SQLite database, gh CLI adapter, git CLI adapter, workspace management, and boot flow are all production-ready. The design system CSS is fully implemented.

What remains is building the actual interactive renderer components that consume this API. This document specifies exactly what to build, in what order, with precise file paths, component interfaces, and behavioral details.

**Rule: Every component described here must use real tRPC data. No more hardcoded placeholders.**

---

## Build Order

This order is strict. Each step depends on the previous one.

1. Wire PR Inbox to real data
2. Wire PR Detail header to real data
3. Build the diff parser
4. Build the diff viewer (virtualized)
5. Build the file tree sidebar
6. Wire the CI/CD Checks panel to real data
7. Build the CI log viewer
8. Build the merge flow
9. Build blame-on-hover
10. Build review rounds (incremental diff)
11. Add polling + caching
12. Fix keyboard shortcuts
13. Polish and glue

---

## Step 1: Wire PR Inbox to Real Data

**File:** `src/renderer/components/pr-inbox.tsx`

**What to change:**

Delete the `PLACEHOLDER_PRS` array entirely. Replace it with real tRPC queries.

The component needs to:

1. Import and use `useWorkspace()` from `@/renderer/lib/workspace-context` to get `cwd`.
2. Make two tRPC queries:
   - `trpc.pr.list.queryOptions({ cwd, filter: "review-requested" })` — PRs that need your review
   - `trpc.pr.list.queryOptions({ cwd, filter: "author" })` — Your own PRs
3. Display results in two sections with appropriate section labels and colored dots:
   - "Needs your review" (purple dot) — from the review-requested query
   - "Your pull requests" (dynamic dot: green for merged/approved+passing CI, red for failing CI, amber for pending/draft)
4. Each PR item shows:
   - Status dot (mapped from `pr.statusCheckRollup` + `pr.reviewDecision`)
   - Title (from `pr.title`)
   - Meta line: repo name (extracted from the workspace path basename or pr data), relative time (use `relativeTime()` from `@/shared/format`)
5. Loading state: Show `Spinner` component while queries are pending.
6. Empty state: Show a message when no PRs exist using the `Empty` component from coss-ui.
7. Error state: Show error message if tRPC query fails.

**Status dot color mapping:**

```
reviewDecision === "APPROVED" && statusCheckRollup === "SUCCESS" → success (green)
statusCheckRollup === "FAILURE" || statusCheckRollup === "ERROR" → danger (red)
statusCheckRollup === "PENDING" || isDraft → warning (amber)
reviewDecision === "REVIEW_REQUIRED" → purple
default → text-tertiary (gray)
```

**Search box:** Make it functional. Filter the combined PR list client-side by title or number. Use a controlled input. Debounce with 150ms.

**Keyboard fixes:** Modify the `keydown` handler to check `event.target` — ignore j/k/Enter if the active element is an `input`, `textarea`, or `[contenteditable]`.

**Polling:** Add `refetchInterval: 30_000` to both queries so data refreshes every 30 seconds.

**Caching:** On successful fetch, call `trpc.pr.list` and let React Query handle the cache. The SQLite `cachePrList` / `getCachedPrList` can be used later for instant first-paint — skip for now, React Query's staleTime: 30s is sufficient.

---

## Step 2: Wire PR Detail Header to Real Data

**File:** `src/renderer/components/pr-detail-view.tsx`

**What to change:**

The component currently receives `prNumber: number` as a prop. It needs to:

1. Import and use `useWorkspace()` to get `cwd`.
2. Query `trpc.pr.detail.queryOptions({ cwd, prNumber })` to get full PR data.
3. Replace all hardcoded header values with real data:
   - Title: `pr.title`
   - Number: `pr.number` (shown as `#847`)
   - Author + time: `pr.author.login` + `relativeTime(pr.createdAt)`
   - Branch: `pr.headRefName` → `pr.baseRefName`
   - File count: `pr.files.length` (from the files array in detail response)
   - Additions/deletions: sum `pr.files[].additions` and `pr.files[].deletions`
4. Show loading skeleton while query is pending.
5. Show error state if query fails.

**The Approve button** should remain non-functional for now (will be wired in a later phase — approve requires `gh pr review --approve` which isn't in the adapter yet).

**The Checkout button** should remain non-functional for now.

---

## Step 3: Build the Diff Parser

**New file:** `src/renderer/lib/diff-parser.ts`

This is a pure function that takes a unified diff string (from `trpc.pr.diff`) and parses it into a structured format the diff viewer can render.

**Input:** Raw unified diff string (the output of `gh pr diff N` or `git diff`).

**Output type:**

```typescript
type DiffFile = {
  oldPath: string;
  newPath: string;
  status: "added" | "deleted" | "modified" | "renamed";
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
};

type DiffHunk = {
  header: string; // e.g., "@@ -1,8 +1,14 @@ import { StreamController }"
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
};

type DiffLine = {
  type: "context" | "add" | "del" | "hunk-header";
  content: string; // The actual line text (without +/- prefix)
  oldLineNumber: number | null;
  newLineNumber: number | null;
};
```

**Parsing rules:**

1. Split the diff by `diff --git` to get individual files.
2. For each file:
   - Parse the `--- a/path` and `+++ b/path` lines for file paths. Handle `/dev/null` for new/deleted files.
   - Determine status: if old path is `/dev/null` → "added", if new path is `/dev/null` → "deleted", if old path !== new path → "renamed", else → "modified".
   - Parse each `@@` hunk header for line numbers.
   - Parse lines within hunks: `+` prefix → "add", `-` prefix → "del", space prefix → "context", no prefix → "context".
   - Track line numbers: context and add lines increment newLineNumber, context and del lines increment oldLineNumber.
   - Count additions and deletions per file.
3. Return an array of `DiffFile`.

**Word-level diff:** Add a function `computeWordDiff(oldLine: string, newLine: string): { oldSegments: Segment[], newSegments: Segment[] }` where `Segment = { text: string, type: "equal" | "change" }`. Use a simple longest-common-subsequence algorithm at the character level. This function should be called for consecutive del+add line pairs to highlight exactly which characters changed.

**Write tests** in `src/renderer/lib/diff-parser.test.ts` covering:

- Simple add/delete/modify
- New file (old path is /dev/null)
- Deleted file (new path is /dev/null)
- Renamed file
- Multiple hunks in one file
- Multiple files in one diff
- Binary files (should be skipped or marked)
- Empty diff

---

## Step 4: Build the Diff Viewer (Virtualized)

**New file:** `src/renderer/components/diff-viewer.tsx`

This is the most important component in the entire application. It renders a parsed diff with virtualized scrolling, syntax highlighting, and the design system's diff color tokens.

**Props:**

```typescript
type DiffViewerProps = {
  file: DiffFile;
  mode: "unified" | "split";
};
```

**Architecture:**

Use `@tanstack/react-virtual` (`useVirtualizer`) to only render visible lines. The virtualizer's `count` is the total number of lines across all hunks in the file. Each line is estimated at 20px height (matching the design system's code line-height).

**Rendering each line:**

1. **Hunk headers:** Background `var(--diff-hunk-bg)`, color `var(--color-info)`, font 11px mono, padding `4px 12px`. Display the hunk header text. Make these `position: sticky; top: 0; z-index: 1`.

2. **Context lines:** No background color. Gutter shows both old and new line numbers.

3. **Added lines:** Background `var(--diff-add-bg)`. Marker column shows `+` in `var(--color-success)`. Gutter shows only the new line number.

4. **Deleted lines:** Background `var(--diff-del-bg)`. Marker column shows `-` in `var(--color-danger)`. Gutter shows only the old line number.

5. **Word-level highlights:** When a del line is immediately followed by an add line (or vice versa), run `computeWordDiff()` from the diff parser. Wrap changed segments in `<span>` with `var(--diff-add-word)` or `var(--diff-del-word)` background.

**Line structure (unified mode):**

```
[gutter 52px: oldNum | newNum] [marker 16px: +/-/space] [code: flex-1]
```

- Gutter: two columns of 22px, right-aligned, `var(--text-ghost)`, font 11px mono. Click handler on gutter for future inline commenting.
- Marker: 16px wide, centered, weight 600, font 11px.
- Code: `white-space: pre`, `tab-size: 4`, `font-family: var(--font-mono)`, `font-size: 12.5px`, `line-height: 20px`, `padding: 0 12px 0 4px`, `overflow-x: auto`.

**Hover behavior:** Each line gets `filter: brightness(1.15)` on hover via CSS (already in the design system).

**Syntax highlighting:** Defer this. Ship first without syntax highlighting — just render the raw text. Shiki WASM integration is a separate task. The code should be structured so a `highlightLine(content, language)` function can be swapped in later.

**Scroll container:** The entire diff content area (`diff-content` in the layout) is the scroll parent for the virtualizer. Use `overflow-y: auto` on this container.

**Performance target:** 50,000 lines must scroll smoothly at 60fps. With virtualization and 20px row height, only ~50-60 rows are in the DOM at any time, so this should be easily achievable.

---

## Step 5: Build the File Tree Sidebar

**New file:** `src/renderer/components/file-tree.tsx`

This replaces the "Files" tab content in the side panel. It shows all changed files from the parsed diff, with viewed state and navigation.

**Props:**

```typescript
type FileTreeProps = {
  files: DiffFile[];
  currentFileIndex: number;
  onSelectFile: (index: number) => void;
  viewedFiles: Set<string>; // file paths
  onToggleViewed: (filePath: string, viewed: boolean) => void;
};
```

**Rendering:**

A flat list (not nested directories — keep it simple for v1). Each row shows:

```
[checkbox] [file icon based on status] [filename] [+N / -N stats]
```

- Checkbox: checked if the file path is in `viewedFiles`. Calls `onToggleViewed` which triggers `trpc.review.setFileViewed`.
- File icon: A small colored dot — green for added, red for deleted, amber for modified, blue for renamed. (Same colors as the diff bar indicators in the design system.)
- Filename: Show just the filename, with the directory path in `var(--text-tertiary)` above or before it. Mono font, 12px.
- Stats: `+N` in green, `-N` in red, mono font 10px.
- Active file: Highlight with `var(--accent-muted)` background and `var(--accent)` left border (same pattern as active PR in sidebar).

**Keyboard:** `[` and `]` to navigate prev/next file (defined in the parent component that manages `currentFileIndex`).

**Progress indicator:** At the top of the file tree, show "X/Y files reviewed" with the design system's progress bar component (60px track, accent fill).

**Integration:** The parent `PrDetailView` component manages:

- `currentFileIndex` state
- `viewedFiles` set (from `trpc.review.viewedFiles` query)
- Calls `trpc.review.setFileViewed` mutation on checkbox toggle
- Passes the correct `DiffFile` to the `DiffViewer` based on `currentFileIndex`

---

## Step 6: Wire the CI/CD Checks Panel to Real Data

**File:** `src/renderer/components/pr-detail-view.tsx` (refactor the checks section)

**Alternatively, extract to:** `src/renderer/components/checks-panel.tsx`

**What to change:**

1. Query `trpc.checks.list.queryOptions({ cwd, prNumber })` to get real check runs.
2. Replace hardcoded check items with real data.
3. Each check item shows:
   - Status icon: checkmark (success), X (failure), spinning clock (in_progress/pending/queued). Use Lucide icons: `CheckCircle2`, `XCircle`, `Clock`.
   - Name: `check.name`
   - Detail: `check.status` + duration (compute from `check.startedAt` and `check.completedAt` if available, otherwise show "Running... Xm Xs")
   - Re-run button: For failed checks, show a ghost button that calls `trpc.checks.rerunFailed.mutate({ cwd, runId: check.detailsUrl extracted run ID })`. Note: extracting runId from the check data may require parsing — the `gh pr checks --json` output includes `detailsUrl` which contains the run ID.
4. Group checks into "Required" and "Optional" sections if possible (this info isn't directly in the check data — may need to display as a flat list for v1).
5. Add `refetchInterval: 10_000` (10 seconds) to the checks query so CI status updates live. This is a faster poll than PR list because CI status changes more frequently.

**Status icon color mapping:**

```
status === "SUCCESS" || conclusion === "success" → success (green)
status === "FAILURE" || conclusion === "failure" → danger (red)
status === "IN_PROGRESS" || status === "QUEUED" || status === "PENDING" → warning (amber, with spin animation)
status === "CANCELLED" || conclusion === "cancelled" → text-tertiary (gray)
status === "SKIPPED" || conclusion === "skipped" → text-tertiary (gray)
```

---

## Step 7: Build the CI Log Viewer

**New file:** `src/renderer/components/log-viewer.tsx`

When a check item in the checks panel is clicked/expanded, show the CI logs inline.

**Props:**

```typescript
type LogViewerProps = {
  cwd: string;
  runId: number;
};
```

**Behavior:**

1. On mount, call `trpc.checks.logs.queryOptions({ cwd, runId })` to fetch the raw log text.
2. Parse ANSI escape codes into styled HTML. Use a library like `ansi-to-html` (install as a dependency) or write a minimal ANSI parser. Support: bold, dim, colors (8-color + 256-color), reset.
3. Render the parsed output in a scrollable container with:
   - Font: `var(--font-mono)`, 11px, line-height 16px
   - Background: `var(--bg-root)` (the darkest surface)
   - Padding: 12px
   - Max height: 400px with overflow-y auto
4. Collapsible `##[group]` / `##[endgroup]` sections: Parse these GitHub Actions markers and wrap content in a collapsible section. Default to collapsed. Click to expand.
5. Search: `Cmd+F` within the log viewer should use the browser's native find (since this is Electron, it works). Alternatively, implement a custom search bar at the top of the log viewer with highlighting.

**Loading state:** Show a skeleton / spinner while logs load. Logs can be large (megabytes), so show a "Loading logs..." message.

**Error state:** If logs fail to load (e.g., the run is still in progress and logs aren't available yet), show "Logs not available yet" message.

---

## Step 8: Build the Merge Flow

**Modify:** `src/renderer/components/pr-detail-view.tsx` (the merge panel section at the bottom of the side panel)

**Behavior:**

1. The merge panel uses data from the `trpc.pr.detail` query to show a pre-merge checklist:
   - Reviews: `pr.reviewDecision === "APPROVED"` → pass. Show who approved (from `pr.reviews` array).
   - CI: All required checks passing → pass. Use data from `trpc.checks.list`.
   - Conflicts: `pr.mergeable === "MERGEABLE"` → pass. `"CONFLICTING"` → fail. `"UNKNOWN"` → warning.
   - Up to date: This would require comparing base branch — skip for v1. Just show the first three.
2. Merge method selector: A toggle group (from coss-ui `ToggleGroup` component) with three options: "Squash", "Merge", "Rebase". Default to "Squash" (save preference in SQLite via `trpc.review.setPreference` — but this preference key doesn't exist yet; just use React state for now).
3. Merge button:
   - Enabled only when: at least one approval exists AND all required checks pass AND no merge conflicts.
   - On click: Call `trpc.pr.merge.mutate({ cwd, prNumber, strategy })`.
   - While merging: Show spinner on button, disable it.
   - On success: Show toast "PR #N merged. Branch deleted." using the coss-ui `toast` component. Invalidate the PR list query so it refreshes.
   - On error: Show toast with error message.
4. Close button: Non-functional for now (closing a PR is a different operation from merging).

---

## Step 9: Build Blame-on-Hover

**New file:** `src/renderer/components/blame-popover.tsx`

**Behavior:**

1. When the user hovers over any line in the diff viewer for 500ms (debounced), fetch blame data for that line.
2. Call `trpc.git.blame.queryOptions({ cwd, file: currentFile.newPath, line: hoveredLineNumber, ref: "HEAD" })`.
3. Show a popover (use coss-ui `Popover` or `Tooltip` component, or the custom blame-tooltip from the design system) positioned near the hovered line.
4. Popover content per design system section 8.10:
   - Author avatar (initials in colored circle) + author name (11px, weight 500)
   - Date: mono 10px, `var(--text-tertiary)`, relative time
   - Separator: `var(--border-strong)` vertical line
   - Commit message: 11px, `var(--text-secondary)`, truncated at ~200px
   - Shadow: `var(--shadow-md)`
5. Cache blame results per file+line in React Query so repeated hovers don't re-fetch.

**Important:** Blame only works when the repo is cloned locally. If `cwd` doesn't contain the file, the blame call will fail. Handle this gracefully — just don't show the popover.

**Performance:** Blame calls are fast (~50ms for a single line via `git blame -L N,N`), but don't fire on every mouse move. Debounce at 500ms and cancel if the mouse leaves the line.

---

## Step 10: Build Review Rounds (Incremental Diff)

**Modify:** `src/renderer/components/pr-detail-view.tsx` + diff viewer

**Behavior:**

1. On loading a PR, query `trpc.review.getLastSha.queryOptions({ cwd, repo: workspaceName, prNumber })` to get the SHA from the last time the user reviewed this PR.
2. If a previous SHA exists, show a toggle in the diff toolbar: `"All changes"` / `"Since last review"` (use the toggle group component per design system section 8.11).
3. When "Since last review" is active:
   - Call `trpc.git.diff.queryOptions({ cwd, fromRef: lastSha, toRef: pr.headRefOid })` to get only the changes since the last review.
   - Parse this diff and render it instead of the full PR diff.
4. When the user finishes reviewing (could be tied to the Approve button, or a separate "Mark as reviewed" action):
   - Call `trpc.review.saveSha.mutate({ cwd, repo: workspaceName, prNumber, sha: pr.headRefOid })`.
   - This saves the current head SHA so the next visit shows only new changes.

**For v1:** Keep this simple. Just show the toggle and implement the diff-between-SHAs. Don't over-engineer the "when to save" UX.

---

## Step 11: Add Polling + Caching

**Modify:** Multiple components

1. **PR Inbox** (`pr-inbox.tsx`): Add `refetchInterval: 30_000` to both PR list queries. This makes the inbox auto-refresh every 30 seconds.

2. **Checks Panel** (`checks-panel.tsx`): Add `refetchInterval: 10_000` to the checks query. CI status changes faster than PR status.

3. **PR Detail** (`pr-detail-view.tsx`): Add `refetchInterval: 60_000` to the detail query. Less aggressive since detail data changes less often.

4. **Window focus refetch:** The `queryClient` already has `refetchOnWindowFocus: true` (React Query default). When the user switches back to Dispatch, all stale queries re-fetch immediately. This is the most important "polling" mechanism.

---

## Step 12: Fix Keyboard Shortcuts

**New file:** `src/renderer/hooks/use-keyboard-shortcuts.ts`

Build a centralized keyboard shortcut system.

```typescript
type Shortcut = {
  key: string; // e.g., "j", "k", "Enter", "m"
  modifiers?: ("meta" | "shift" | "alt" | "ctrl")[];
  handler: () => void;
  when?: () => boolean; // Only fire if this returns true
};

function useKeyboardShortcuts(shortcuts: Shortcut[]): void;
```

**Rules:**

- Never fire shortcuts when focus is in an `<input>`, `<textarea>`, or `[contenteditable]` element.
- Support modifier keys (`Cmd+B` for sidebar collapse, `Cmd+F` for search).
- Shortcuts are registered/unregistered when the component mounts/unmounts.

**Global shortcuts to implement:**

| Key      | Action                  | Context               |
| -------- | ----------------------- | --------------------- |
| `j`      | Next PR in inbox        | When inbox is focused |
| `k`      | Previous PR in inbox    | When inbox is focused |
| `Enter`  | Open selected PR        | When inbox is focused |
| `[`      | Previous file in diff   | When viewing a PR     |
| `]`      | Next file in diff       | When viewing a PR     |
| `Cmd+B`  | Toggle sidebar collapse | Always                |
| `/`      | Focus search box        | Always                |
| `Escape` | Clear search / deselect | Context-dependent     |

---

## Step 13: Polish and Glue

Small tasks to tie everything together:

1. **Background noise texture:** Add the SVG noise overlay from the design system (section 4.4) to the root layout. It's a `position: fixed` div with `opacity: 0.015` and `pointer-events: none`.

2. **Side panel tabs:** Make the Checks/Reviews/Files tabs actually switch content. Use React state in the parent. The "Reviews" tab can show a simple list of review comments from `pr.reviews` data for now.

3. **Sidebar collapse:** Implement `Cmd+B` to toggle the PR inbox sidebar between 260px and 0px. Use CSS transition: `width 400ms var(--ease-out)`.

4. **Error boundaries:** Wrap `AppLayout` in a React error boundary that catches rendering errors and shows a recovery UI.

5. **Toast notifications:** Set up the coss-ui toast provider at the app root for merge success/failure notifications.

6. **PR number in Navbar:** Update the navbar to show the currently selected PR number/title as breadcrumb context (e.g., "Review > #847 feat: add streaming...").

---

## File Summary

| Action | File                                           | Description                                                                         |
| ------ | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| Modify | `src/renderer/components/pr-inbox.tsx`         | Replace placeholder data with real tRPC queries, add polling, fix keyboard handling |
| Modify | `src/renderer/components/pr-detail-view.tsx`   | Wire to real PR detail data, refactor into proper sub-components                    |
| Create | `src/renderer/lib/diff-parser.ts`              | Unified diff parser (string → structured DiffFile/DiffHunk/DiffLine)                |
| Create | `src/renderer/lib/diff-parser.test.ts`         | Tests for the diff parser                                                           |
| Create | `src/renderer/components/diff-viewer.tsx`      | Virtualized diff rendering with @tanstack/react-virtual                             |
| Create | `src/renderer/components/file-tree.tsx`        | Changed file list with viewed checkboxes                                            |
| Create | `src/renderer/components/checks-panel.tsx`     | Real CI check status with live polling and re-run                                   |
| Create | `src/renderer/components/log-viewer.tsx`       | ANSI-parsed CI log viewer                                                           |
| Create | `src/renderer/components/blame-popover.tsx`    | Git blame tooltip on hover                                                          |
| Create | `src/renderer/hooks/use-keyboard-shortcuts.ts` | Centralized keyboard shortcut system                                                |
| Modify | `src/renderer/components/app-layout.tsx`       | Add sidebar collapse, error boundary, toast provider                                |
| Modify | `src/renderer/components/navbar.tsx`           | Add PR context breadcrumb                                                           |

## Dependencies to Install

```bash
bun add ansi-to-html
```

No other new dependencies required. `@tanstack/react-virtual` is already installed. The diff parser and word-diff are pure TypeScript with no external dependencies.
