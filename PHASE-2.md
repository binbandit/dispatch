# Phase 2: Workflow Operations, Polish Gaps & Production Readiness

## Where We Are

Phase 1 (MVP) is functionally complete. The app handles the full PR review lifecycle:

- Real-time PR inbox with search, keyboard nav, size badges, 30s polling
- Virtualized diff viewer with Shiki syntax highlighting, word-level diffs
- Blame-on-hover, inline PR comments (display + create), CI annotations in diff
- Checks panel with live polling, log viewer (ANSI colors, collapsible groups), re-run
- Approve + merge flow with pre-merge checklist validation
- Review rounds (all changes / since last review)
- Viewed files tracking (persistent across restarts)
- Full keyboard shortcuts (j/k/Enter/[/]/Cmd+B/Escape)

### Screenshot Assessment

Looking at the current UI, the design system is landing well — the copper accent, warm dark surfaces, editorial serif logo, and monospace metadata are all present. The layout (sidebar, diff viewer, file tree panel) works as designed.

### Phase 1 Gaps to Clean Up First

Before building Phase 2 features, we need to close these Phase 1C gaps. They're small but they affect quality perception:

---

## Part A: Phase 1 Cleanup (do these first)

### A1. Request Changes Button

The approve button works. Add a "Request Changes" button next to it.

**Modify:** `src/renderer/components/pr-detail-view.tsx`

Add a `RequestChangesButton` component next to `ApproveButton`:

- Ghost variant button with destructive styling, label "Request Changes"
- On click: Open a small popover/dropdown with a `<textarea>` (placeholder: "What needs to change?") and a "Submit" button
- On submit: Call `ipc("pr.submitReview", { cwd, prNumber, event: "REQUEST_CHANGES", body })`. Toast on success. Invalidate PR queries.
- Use the coss-ui `Popover` component for the dropdown

### A2. Merge Strategy Selector

The merge button always squashes. The state variable exists (`_setStrategy`) but was never exposed.

**Modify:** `src/renderer/components/pr-detail-view.tsx` — `MergeButton` component

Replace the single merge button with a split button:

- Main area: "Squash & Merge" / "Merge" / "Rebase & Merge" (label changes based on selected strategy)
- Dropdown chevron on the right: Opens a menu with the three options
- Use coss-ui `Menu` component for the dropdown
- Persist the selected strategy in React state (localStorage for cross-session persistence is a nice-to-have)

### A3. Toast on All Mutations

Add toasts where they're missing:

| Mutation       | File                   | Toast                                                         |
| -------------- | ---------------------- | ------------------------------------------------------------- |
| Re-run failed  | `checks-panel.tsx`     | Success: "Re-run started" / Error: "Re-run failed: {message}" |
| Create comment | `comment-composer.tsx` | Success: "Comment added"                                      |
| Mark reviewed  | `pr-detail-view.tsx`   | Success: "Review SHA saved"                                   |

### A4. Consolidate Keyboard Shortcuts

Migrate all raw `addEventListener` calls to the centralized `useKeyboardShortcuts` system.

**Modify:** `pr-inbox.tsx` — Move j/k/Enter/Escape handling to `useKeyboardShortcuts` call. Remove the raw `useEffect` + `addEventListener`.

**Modify:** `pr-detail-view.tsx` — Move [/] handling to `useKeyboardShortcuts`. Remove the raw `useEffect`.

**Add new shortcuts via `useKeyboardShortcuts` in `app-layout.tsx` or a new `src/renderer/hooks/use-global-shortcuts.ts`:**

| Key | Action                               | `when` condition      |
| --- | ------------------------------------ | --------------------- |
| `a` | Approve current PR                   | When a PR is selected |
| `v` | Toggle viewed state for current file | When viewing a diff   |
| `n` | Jump to next unreviewed file         | When viewing a diff   |

### A5. File Tree Sorting

**Modify:** `src/renderer/components/file-tree.tsx`

Sort files before rendering: group by top-level directory (alphabetical), then sort files within each group alphabetically. Add a visual directory group header (just the directory name in `text-text-tertiary` font-mono 10px).

### A6. Loading Skeletons

Replace `<Spinner>` loading states with shaped skeleton placeholders. Import `Skeleton` from `@/components/ui/skeleton`.

| Location                         | Skeleton shape                                     |
| -------------------------------- | -------------------------------------------------- |
| PR detail header (while loading) | Two lines: 200px wide bar + 300px wide bar         |
| Diff viewer (while loading)      | 8 rows of alternating 80%/60% width bars           |
| File tree (while loading)        | 6 rows of 90% width bars with small square on left |
| Checks panel (while loading)     | 4 rows of full-width bars with circle on left      |

### A7. Remove Unused Dependencies

- `ansi-to-html` is installed but unused (custom ANSI parser was built instead). Remove from `package.json`.

### A8. Fix Potential Hunk Header Duplication

**Investigate:** `diff-viewer.tsx` `buildVirtualRows()` may insert a separate hunk-header row AND the `hunk.lines` array already contains a hunk-header `DiffLine` from the parser. Verify and deduplicate if needed.

---

## Part B: Phase 2 Features — Workflow Operations

Per the original plan, Phase 2 expands from "review a PR" to "manage the CI/CD pipeline."

### B1. Workflows Dashboard

**New view.** This is a new top-level screen, accessible from a "Workflows" nav tab in the navbar.

#### B1.1 Client-Side Routing

The app currently has no routing — it's a single view. We need minimal client-side routing to support multiple views.

**New file:** `src/renderer/lib/router.tsx`

Don't install `react-router`. Build a simple state-based router:

```typescript
type Route =
  | { view: "review"; prNumber: number | null }
  | { view: "workflows" }
  | { view: "settings" };

const RouterContext = createContext<{
  route: Route;
  navigate: (route: Route) => void;
}>({ route: { view: "review", prNumber: null }, navigate: () => {} });
```

**Modify:** `src/renderer/components/app-layout.tsx`

Wrap content in `RouterProvider`. Render `PrInbox` + `PrDetailView` when `route.view === "review"`. Render `WorkflowsDashboard` when `route.view === "workflows"`.

**Modify:** `src/renderer/components/navbar.tsx`

Make nav tabs clickable. Add "Workflows" tab. Active tab follows `route.view`. Count badge on "Review" tab shows total pending PRs.

#### B1.2 Workflows List

**New IPC endpoints:**

Add to `src/main/services/gh-cli.ts`:

```typescript
export async function listWorkflows(cwd: string): Promise<GhWorkflow[]> {
  const { stdout } = await exec(`gh workflow list --json id,name,state --limit 50`, { cwd });
  return JSON.parse(stdout);
}

export type GhWorkflow = {
  id: number;
  name: string;
  state: "active" | "disabled_manually" | "disabled_inactivity";
};

export async function listWorkflowRuns(
  cwd: string,
  workflowId?: number,
  limit = 20,
): Promise<GhWorkflowRun[]> {
  let cmd = `gh run list --json databaseId,displayTitle,name,status,conclusion,headBranch,createdAt,updatedAt,event,workflowName,attempt --limit ${limit}`;
  if (workflowId) {
    cmd += ` --workflow ${workflowId}`;
  }
  const { stdout } = await exec(cmd, { cwd });
  return JSON.parse(stdout);
}

export type GhWorkflowRun = {
  databaseId: number;
  displayTitle: string;
  name: string;
  status: string;
  conclusion: string | null;
  headBranch: string;
  createdAt: string;
  updatedAt: string;
  event: string;
  workflowName: string;
  attempt: number;
};

export async function getWorkflowRunDetail(
  cwd: string,
  runId: number,
): Promise<GhWorkflowRunDetail> {
  const { stdout } = await exec(
    `gh run view ${runId} --json databaseId,displayTitle,name,status,conclusion,headBranch,headSha,createdAt,updatedAt,event,workflowName,jobs,attempt`,
    { cwd },
  );
  return JSON.parse(stdout);
}

export type GhWorkflowRunJob = {
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string;
  completedAt: string;
  steps: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    number: number;
  }>;
};

export type GhWorkflowRunDetail = GhWorkflowRun & {
  headSha: string;
  jobs: GhWorkflowRunJob[];
};

export async function triggerWorkflow(
  cwd: string,
  workflowId: string,
  ref: string,
  inputs?: Record<string, string>,
): Promise<void> {
  let cmd = `gh workflow run ${workflowId} --ref ${ref}`;
  if (inputs) {
    for (const [key, value] of Object.entries(inputs)) {
      cmd += ` -f ${key}=${value}`;
    }
  }
  await exec(cmd, { cwd, timeout: 15_000 });
}

export async function cancelWorkflowRun(cwd: string, runId: number): Promise<void> {
  await exec(`gh run cancel ${runId}`, { cwd });
}

export async function getWorkflowYaml(cwd: string, workflowId: number): Promise<string> {
  const { stdout } = await exec(`gh workflow view ${workflowId} --yaml`, { cwd });
  return stdout;
}
```

Add all these to `src/shared/ipc.ts` and `src/main/ipc-handler.ts`.

#### B1.3 Workflows Dashboard Component

**New file:** `src/renderer/components/workflows-dashboard.tsx`

Layout:

```
+--[ Workflow selector (dropdown) ]--[ Trigger button ]--+
|                                                         |
|  Run list (table)                                       |
|  ┌─────────────────────────────────────────────────────┐|
|  │ Status │ Title          │ Branch │ Duration │ Time  ││
|  │   ●    │ CI / Build     │ main   │ 2m 34s   │ 3m   ││
|  │   ✕    │ CI / Build     │ feat/x │ 1m 12s   │ 15m  ││
|  │   ●    │ Release        │ main   │ 5m 01s   │ 1h   ││
|  └─────────────────────────────────────────────────────┘|
|                                                         |
|  Selected run detail (expandable)                       |
|  ┌─────────────────────────────────────────────────────┐|
|  │ Job timeline (Gantt-style)                          ││
|  │ ██████░░░░░░░░  build (2m)                          ││
|  │ ░░░░░░██████░░  test  (2m)                          ││
|  │ ░░░░░░░░░░████  deploy (1m)                         ││
|  └─────────────────────────────────────────────────────┘|
+---------------------------------------------------------+
```

**Workflow selector:**

- Dropdown listing all workflows from `ipc("workflows.list")`. Default to "All workflows."
- Selecting a workflow filters the run list.

**Run list table:**

- Data from `ipc("workflows.runs", { workflowId })` with 15s polling.
- Columns: Status icon, Title (run display title), Branch, Duration (computed from createdAt/updatedAt), Time ago (relative).
- Row click: Expands to show run detail below the table.
- Row actions: Re-run (for failed), Cancel (for in-progress), View logs.

**Trigger button:**

- Opens a dialog/popover.
- Fetches workflow YAML via `ipc("workflows.yaml", { workflowId })`.
- Parses `workflow_dispatch.inputs` from the YAML to auto-generate a form.
- Ref selector: text input defaulting to "main".
- Submit calls `ipc("workflows.trigger", { workflowId, ref, inputs })`.
- Show toast on success/error.

#### B1.4 Run Detail — Job Timeline

**New file:** `src/renderer/components/run-detail.tsx`

When a run is selected from the list, show its jobs in a Gantt-style timeline.

Data from `ipc("workflows.runDetail", { runId })`.

**Gantt rendering:**

- Each job is a horizontal bar.
- X-axis is time (earliest `startedAt` to latest `completedAt`).
- Bar color: green for success, red for failure, amber for in-progress, gray for skipped.
- Bar width proportional to duration.
- Label on bar: job name + duration.
- Jobs that ran in parallel appear on the same row or adjacent rows at the same x-offset.

Implementation: Calculate the total timeline span. For each job, compute its position and width as percentages. Render as positioned divs inside a relative container. No external charting library needed — this is just CSS positioning.

**Below the timeline:**

- Job list with expandable steps.
- Each step shows status icon + name + duration.
- Click a step to view its logs (reuse `LogViewer` component with a step-specific log fetch — `gh run view {runId} --log` already returns all step logs).

**Run actions:**

- "Re-run all" button: `gh run rerun {runId}`
- "Re-run failed" button: `gh run rerun {runId} --failed`
- "Cancel" button: `ipc("workflows.cancel", { runId })`
- "Download artifacts" button: `gh run download {runId}` — downloads to a temp directory, opens it in Finder/Explorer.

#### B1.5 Run Comparison (Novel Feature)

**New file:** `src/renderer/components/run-comparison.tsx`

Allow selecting 2 runs and comparing them side-by-side.

**Selection:** In the run list table, add a checkbox column. When exactly 2 runs are checked, show a "Compare" button.

**Comparison view:**

- Side-by-side Gantt timelines (left run vs right run)
- Per-job delta table: job name, left duration, right duration, delta (+ or -), delta color (green if faster, red if slower)
- Status changes: jobs that changed status between runs (e.g., pass → fail) highlighted
- Log diff: For jobs that exist in both runs, show a text diff of the log output. Use the same diff parser we already have (`parseDiff`) or a simpler line-diff since these aren't unified diffs. A basic approach: split both logs by newline, find the first divergence point, show the differing sections.

This is a genuinely novel feature nobody offers. Keep it simple for v1 — the comparison table with duration deltas is the minimum viable version. Log diffing is a stretch goal.

### B2. Workspace Switcher + Settings

#### B2.1 Workspace Switcher

**Modify:** `src/renderer/components/navbar.tsx`

The avatar / settings area needs a workspace indicator + switcher.

Add a workspace name display (the repo name, mono text) next to the logo or in the right area. Click it to open a dropdown with:

- List of all workspaces (from `ipc("workspace.list")`)
- Active workspace highlighted
- Click a different workspace to switch (`ipc("workspace.setActive", { path })` → invalidate all queries → refresh)
- "Add repository..." option at the bottom (opens folder picker)
- "Remove" option per workspace (with confirmation)

This unblocks multi-repo usage without a full settings panel.

#### B2.2 Settings Panel

**New file:** `src/renderer/components/settings-view.tsx`

Accessible from the Settings icon in the navbar (currently non-functional) or via router navigation to `{ view: "settings" }`.

Settings to include:

| Setting                | Control                                                    | Storage                                                    |
| ---------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Default merge strategy | Toggle group: Squash / Merge / Rebase                      | `ipc("preferences.set", { key: "merge-strategy", value })` |
| Polling intervals      | Number inputs: PR list (default 30s), Checks (default 10s) | Preferences                                                |
| AI provider (future)   | Dropdown: None / OpenAI / Anthropic / Ollama               | Preferences                                                |
| AI API key (future)    | Password input                                             | Preferences (encrypted — stretch goal)                     |
| Theme (future)         | Not for v1 — single dark theme                             | N/A                                                        |
| About                  | App version, links                                         | Static                                                     |

For v1, just implement merge strategy and polling intervals. The AI and theme settings are placeholders.

### B3. Notifications (Desktop-Native)

**New file:** `src/renderer/lib/notifications.ts`

Leverage Electron's native notification system.

```typescript
export function sendNotification(title: string, body: string): void {
  // In the renderer, use the Web Notification API (Electron supports it)
  new Notification(title, { body, silent: false });
}
```

**New file:** `src/renderer/hooks/use-notification-polling.ts`

A background hook that polls for changes and sends notifications:

1. Track the "last known" PR list in a ref.
2. On each 30s poll result, compare with the previous list.
3. Trigger a notification when:
   - A new PR is assigned for review → "New review request: {title}"
   - CI fails on your PR → "CI failed on #{number}: {title}"
   - Your PR gets approved → "PR #{number} approved"
   - Your PR gets merged → "PR #{number} merged"
4. This runs in the renderer process using the Web Notification API (works in Electron).

**Modify:** `src/renderer/components/app-layout.tsx`

Call `useNotificationPolling()` at the top level so it runs in the background.

**Notification center (stretch):** A panel behind the bell icon showing recent notifications. For v1, just send OS notifications and skip the in-app notification center.

### B4. Menu Bar / System Tray Presence

**Modify:** `src/main/index.ts`

Add a macOS menu bar tray icon (or Windows system tray):

```typescript
import { Tray, nativeImage } from "electron";

// After window creation:
const trayIcon = nativeImage.createFromDataURL(/* 16x16 copper logo PNG as data URL */);
const tray = new Tray(trayIcon);
tray.setToolTip("Dispatch");

// Update badge count when PR list changes
// (requires IPC from renderer to main when PR count updates)
```

On macOS, show a badge count on the dock icon:

```typescript
app.setBadgeCount(pendingReviewCount);
```

This makes Dispatch feel like a real native app — you see the review count without opening it.

---

## New Files Summary

| Action | File                                              | Description                                                          |
| ------ | ------------------------------------------------- | -------------------------------------------------------------------- |
| Create | `src/renderer/lib/router.tsx`                     | Simple state-based client-side router                                |
| Create | `src/renderer/components/workflows-dashboard.tsx` | Workflow list, run history, trigger workflows                        |
| Create | `src/renderer/components/run-detail.tsx`          | Gantt-style job timeline, step viewer                                |
| Create | `src/renderer/components/run-comparison.tsx`      | Side-by-side run comparison with duration deltas                     |
| Create | `src/renderer/components/settings-view.tsx`       | Settings panel (merge strategy, polling intervals)                   |
| Create | `src/renderer/lib/notifications.ts`               | Desktop notification helper                                          |
| Create | `src/renderer/hooks/use-notification-polling.ts`  | Background polling for notification triggers                         |
| Modify | `src/main/services/gh-cli.ts`                     | Add workflow functions: list, runs, runDetail, trigger, cancel, yaml |
| Modify | `src/shared/ipc.ts`                               | Add workflow IPC endpoints + types                                   |
| Modify | `src/main/ipc-handler.ts`                         | Register new workflow handlers                                       |
| Modify | `src/renderer/components/navbar.tsx`              | Add Workflows tab, workspace switcher, make tabs route-aware         |
| Modify | `src/renderer/components/app-layout.tsx`          | Add router, notification polling, multi-view rendering               |
| Modify | `src/renderer/components/pr-detail-view.tsx`      | Request Changes button, merge strategy selector, missing toasts      |
| Modify | `src/renderer/components/pr-inbox.tsx`            | Migrate to useKeyboardShortcuts                                      |
| Modify | `src/renderer/components/file-tree.tsx`           | Sort files by directory then name                                    |
| Modify | `src/renderer/components/checks-panel.tsx`        | Add toasts on re-run                                                 |
| Modify | `src/main/index.ts`                               | Add system tray / dock badge                                         |

## New IPC Endpoints

| Endpoint              | Service Function                             | Description                                |
| --------------------- | -------------------------------------------- | ------------------------------------------ |
| `workflows.list`      | `listWorkflows`                              | List all workflows in the repo             |
| `workflows.runs`      | `listWorkflowRuns`                           | List runs, optionally filtered by workflow |
| `workflows.runDetail` | `getWorkflowRunDetail`                       | Get run with jobs + steps                  |
| `workflows.trigger`   | `triggerWorkflow`                            | Trigger a `workflow_dispatch` run          |
| `workflows.cancel`    | `cancelWorkflowRun`                          | Cancel an in-progress run                  |
| `workflows.yaml`      | `getWorkflowYaml`                            | Get workflow YAML for input parsing        |
| `workflows.rerunAll`  | Re-use `rerunFailedJobs` with different flag | Re-run all jobs                            |

## Dependencies

No new dependencies required. All features use existing packages (Electron APIs, `gh` CLI, existing UI components).

---

## After Phase 2

The app will have:

- Full PR review lifecycle (Phase 1) ✓
- CI/CD workflow management: view runs, trigger workflows, compare runs, Gantt timelines
- Multi-workspace support with in-app switching
- Desktop notifications for review requests, CI failures, approvals
- Dock badge / system tray presence
- Settings panel with configurable merge strategy and poll intervals
- Client-side routing for multiple views

**Phase 3** (next after this) will cover:

- Multi-repo unified inbox (cross-repo PR view)
- Team metrics (cycle time, review latency, size trends)
- Advanced AI features (inline explanations, review summaries, commit archaeology)
- Release management (changelog generation, deployment pipeline visualization)
