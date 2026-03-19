# Phase 3: Multi-Repo, AI Intelligence & Release Management

## Prerequisites

Before starting Phase 3, these Phase 2 items MUST be resolved:

1. **Virtualize the diff viewer.** `@tanstack/react-virtual` is installed but unused. The diff viewer renders all rows in the DOM. Wire `useVirtualizer` into `diff-viewer.tsx`. This is a blocking performance issue for any real-world usage on large PRs. Do this first.

2. **Loading skeletons.** Replace all remaining `<Spinner>` loading states with shaped `<Skeleton>` placeholders. The coss-ui Skeleton component exists in `src/components/ui/skeleton.tsx`. Target: PR detail header, diff viewer, file tree, checks panel, workflows run list.

3. **Workflow trigger input form.** The `workflows.yaml` IPC endpoint exists. Parse the YAML's `workflow_dispatch.inputs` section and render a dynamic form (text inputs, dropdowns for `type: choice`, checkboxes for `type: boolean`). The current trigger button hardcodes "main" with no inputs.

---

## Phase 3 Features

### 3.1 Multi-Repo Unified Inbox

The inbox currently shows PRs from the active workspace only. Engineers work across multiple repos. The unified inbox shows all PRs across all configured workspaces in one view.

#### 3.1.1 Backend Changes

**New IPC endpoint:** `pr.listAll`

This queries PR data from every configured workspace in parallel.

**Modify:** `src/main/services/gh-cli.ts`

```typescript
export async function listAllPrs(
  workspaces: Array<{ path: string; name: string }>,
  filter: "reviewRequested" | "authored",
): Promise<Array<GhPrListItem & { workspace: string; workspacePath: string }>> {
  const results = await Promise.allSettled(
    workspaces.map(async (ws) => {
      const prs = await listPrs(ws.path, filter);
      return prs.map((pr) => ({ ...pr, workspace: ws.name, workspacePath: ws.path }));
    }),
  );

  return results
    .filter(
      (
        r,
      ): r is PromiseFulfilledResult<
        (typeof results)[0] extends PromiseFulfilledResult<infer T> ? T : never
      > => r.status === "fulfilled",
    )
    .flatMap((r) => r.value);
}
```

**Add to IPC contract and handler.**

#### 3.1.2 UI Changes

**Modify:** `src/renderer/components/pr-inbox.tsx`

Add a "All repos" toggle at the top of the inbox, above the existing filter tabs:

```
[Active repo ▾] | [All repos]
```

When "All repos" is active:

- Query `pr.listAll` instead of `pr.list`
- Each PR item shows the repo name as a secondary label (e.g., `api-gateway` in `text-text-tertiary` mono 10px)
- Group PRs by repo, or show them in a flat list sorted by `updatedAt` (flat list is simpler and better for triage)
- Clicking a PR from a different repo automatically switches the workspace context to that repo's `workspacePath` (no full reload — just update the workspace context)

When "Active repo" is selected, behavior is unchanged (current implementation).

**Important:** The active workspace must switch seamlessly when the user clicks a PR from a different repo. The diff viewer, blame, and file history all depend on `cwd`. Update the workspace context, invalidate queries for the old workspace, and let React Query refetch for the new one.

#### 3.1.3 Cross-Repo Notification Polling

**Modify:** `src/renderer/hooks/use-notification-polling.ts`

When multi-repo mode is active, poll across all workspaces. Use `pr.listAll` instead of `pr.list`. The notification logic (new review, CI fail, approval) stays the same — just operates on the combined list.

Update the dock badge to show the total pending review count across all repos.

---

### 3.2 Team Metrics Dashboard

A new view (accessible from a "Metrics" nav tab or within settings) that shows PR velocity and review health for the active repo. All data computed locally from `gh` API — no server needed.

#### 3.2.1 Backend: Metrics Data Collection

**New IPC endpoints:**

```typescript
"metrics.prCycleTime": {
  args: { cwd: string; since: string }; // since = ISO date, e.g., "2026-02-19"
  result: Array<{
    prNumber: number;
    title: string;
    author: string;
    createdAt: string;
    mergedAt: string | null;
    firstReviewAt: string | null;
    timeToFirstReview: number | null; // minutes
    timeToMerge: number | null; // minutes
    additions: number;
    deletions: number;
  }>;
};

"metrics.reviewLoad": {
  args: { cwd: string; since: string };
  result: Array<{
    reviewer: string;
    reviewCount: number;
    avgResponseTime: number; // minutes
  }>;
};
```

**Implementation in `gh-cli.ts`:**

Use `gh pr list --state merged --json ... --limit 100` combined with `gh pr view N --json reviews,createdAt,mergedAt` for individual PR data. This is expensive (one `gh` call per PR for review timing), so:

- Cache results in SQLite with a 1-hour TTL
- Limit to the most recent 100 merged PRs
- Run the collection in the background, show a progress indicator

#### 3.2.2 UI: Metrics View

**New file:** `src/renderer/components/metrics-view.tsx`

**Layout:**

```
+--[ Time range selector: 7d / 30d / 90d ]--+
|                                            |
|  Summary cards (top row)                   |
|  ┌────────┐ ┌────────┐ ┌────────┐         |
|  │ Avg    │ │ Avg    │ │ PR     │         |
|  │ cycle  │ │ review │ │ throughput│       |
|  │ time   │ │ time   │ │ /week  │         |
|  └────────┘ └────────┘ └────────┘         |
|                                            |
|  PR cycle time over time (sparkline)       |
|  ▁▂▃▅▇▅▃▂▁▂▃▅▃▂                           |
|                                            |
|  Review load by team member (bar chart)    |
|  alice  ████████████  12 reviews           |
|  bob    ██████  6 reviews                  |
|  carol  ████  4 reviews                   |
|                                            |
|  PR size distribution (histogram)          |
|  S: ████████  8                            |
|  M: ██████████████  14                     |
|  L: ██████  6                              |
|  XL: ██  2                                 |
+--------------------------------------------+
```

**Summary cards:**

- Average cycle time (created → merged): Show in hours or days, with trend arrow (up/down vs previous period)
- Average time to first review: Show in hours, with trend
- PR throughput: PRs merged per week, with trend

**Charts:** Build these with plain CSS/HTML — no charting library. Horizontal bar charts are just `<div>` elements with percentage widths. Sparklines are `<svg>` polylines. Keep it simple, keep it on-brand (use the design system colors).

**Styling:**

- Summary cards: `bg-bg-raised`, `border-border`, `radius-lg`, `p-4`
- Numbers: `font-mono`, large (20-24px), `text-primary`
- Labels: `text-text-tertiary`, 10px uppercase
- Trend indicators: green arrow up (improvement), red arrow down (regression), using `--success` and `--danger`
- Bar chart bars: `--accent` for the fill, `--bg-raised` for the track
- Time range selector: Toggle group per design system section 8.11

#### 3.2.3 Router Integration

Add `{ view: "metrics" }` to the router. Add a "Metrics" nav tab in the navbar (after "Workflows"). Use the chart icon from Lucide (`BarChart3`).

---

### 3.3 AI Layer

AI features that augment the review experience. All AI runs locally or through the user's own API key. We never see their code.

#### 3.3.1 AI Provider Configuration

**Modify:** `src/renderer/components/settings-view.tsx`

Add an "AI" section to settings:

- **Provider selector:** Dropdown — "None" (default), "OpenAI", "Anthropic", "Ollama (local)"
- **API key:** Password input (for OpenAI/Anthropic). Stored in preferences (SQLite). Encrypted at rest is a stretch goal — for now, store plaintext in the local DB (same security model as `gh auth token` in the system keychain).
- **Model selector:** Text input with sensible defaults:
  - OpenAI: `gpt-4o`
  - Anthropic: `claude-sonnet-4-20250514`
  - Ollama: `llama3.1`
- **Base URL override:** For Ollama (default `http://localhost:11434`) or corporate proxies.

**New IPC endpoints:**

```typescript
"ai.complete": {
  args: {
    provider: "openai" | "anthropic" | "ollama";
    model: string;
    apiKey: string;
    baseUrl?: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    maxTokens?: number;
  };
  result: string; // The completion text
};
```

**Implementation in main process:**

**New file:** `src/main/services/ai.ts`

Use raw `fetch()` to call the provider APIs. No SDKs — keep dependencies minimal.

- **OpenAI:** `POST https://api.openai.com/v1/chat/completions`
- **Anthropic:** `POST https://api.anthropic.com/v1/messages`
- **Ollama:** `POST http://localhost:11434/api/chat`

Each provider returns differently — normalize to a plain string response.

#### 3.3.2 Inline Code Explanations

**Trigger:** User selects code in the diff viewer, right-clicks, and chooses "Explain this change" from a context menu.

**New component:** `src/renderer/components/ai-explanation.tsx`

Renders below the selected code range in the diff (similar to how inline comments render). Shows:

- A copper-bordered card (use `--border-accent`)
- Header: "AI Explanation" with a sparkle icon
- Streaming text response (render tokens as they arrive)
- "Dismiss" button to close

**Prompt construction:**

````
System: You are a code review assistant. Explain what the following code change does and why it might have been made. Be concise (2-3 sentences max).

User:
File: {filePath}
Change context:
```diff
{the selected lines from the diff, with +/- markers}
````

Surrounding code for context:

```{language}
{10 lines before and after the selection}
```

```

**Integration:** Add to the diff viewer's context menu (right-click). The context menu should also have: "Copy", "Explain this change" (if AI configured), "View blame".

#### 3.3.3 PR Review Summary

**Trigger:** Automatic when opening a PR (if AI is configured). Shows in a new "AI" tab in the side panel, or as a collapsible section at the top of the diff area.

**New component:** `src/renderer/components/ai-review-summary.tsx`

Generates a structured summary of the entire PR:

1. **Overview:** 1-2 sentence summary of what the PR does
2. **Changes by concern:** Group files into logical categories (e.g., "API changes", "Database migrations", "UI updates", "Tests")
3. **Review focus areas:** Suggest which files deserve the most attention (largest changes, security-sensitive files, files with many past bugs)
4. **Potential issues:** Flag any obvious concerns (TODO comments added, error handling gaps, large functions)

**Prompt construction:**

```

System: You are a senior code reviewer. Analyze this pull request and provide a structured review summary. Group changes by logical concern. Identify areas that deserve close review. Be specific and concise.

User:
PR: {title} #{number}
Author: {author}
Description: {body}

Files changed:
{for each file: path, additions, deletions, first 50 lines of diff}

```

**Caching:** Store the summary in SQLite, keyed by `(repo, prNumber, headSha)`. Don't regenerate if the head SHA hasn't changed.

**Cost awareness:** Show an estimated token count before generating. "This PR has ~4,000 tokens of diff. Generate summary? [Yes] [No]". The user should always opt in.

#### 3.3.4 AI CI Failure Explanation

**Trigger:** When a CI check fails, show an "Explain failure" button on the CI annotation in the diff and in the checks panel.

**Modify:** `src/renderer/components/ci-annotation.tsx` and `checks-panel.tsx`

Add a button: "Explain with AI" (ghost variant, small, with sparkle icon).

On click:
1. Fetch the CI log for the failed run (already available via `checks.logs`)
2. Extract the last 200 lines of the log (the error section)
3. Send to the AI with this prompt:

```

System: A CI/CD pipeline has failed. Explain the failure in plain English and suggest a fix. Be concise.

User:
Check name: {checkName}
Status: Failed

Log output (last 200 lines):

```
{log tail}
```

The code change that likely caused this (from the diff at the annotated line):

```{language}
{5 lines around the annotated line}
```

````

4. Show the response inline below the annotation, in an accent-bordered card.

---

### 3.4 Release Management

#### 3.4.1 Release View

**New IPC endpoints:**

```typescript
"releases.list": {
  args: { cwd: string; limit?: number };
  result: Array<{
    tagName: string;
    name: string;
    body: string;
    isDraft: boolean;
    isPrerelease: boolean;
    createdAt: string;
    author: { login: string };
    assets: Array<{ name: string; size: number; downloadCount: number }>;
  }>;
};

"releases.create": {
  args: {
    cwd: string;
    tagName: string;
    name: string;
    body: string;
    isDraft: boolean;
    isPrerelease: boolean;
    target: string; // branch or SHA
  };
  result: { url: string };
};

"releases.generateChangelog": {
  args: { cwd: string; sinceTag: string };
  result: string; // Markdown changelog
};
````

**Implementation:**

- `releases.list`: `gh release list --json tagName,name,body,isDraft,isPrerelease,createdAt,author,assets --limit N`
- `releases.create`: `gh release create TAG --title NAME --notes BODY [--draft] [--prerelease] [--target BRANCH]`
- `releases.generateChangelog`: `gh pr list --state merged --json title,number,author,mergedAt --limit 100`, filter to PRs merged after `sinceTag`'s date, format as markdown bullet list.

#### 3.4.2 Release UI

**New file:** `src/renderer/components/releases-view.tsx`

Accessible from a "Releases" sub-tab within the Workflows view, or as a separate view.

**Layout:**

```
+--[ Create Release button ]------------------+
|                                              |
|  Release list                                |
|  ┌──────────────────────────────────────────┐|
|  │ v2.1.0 — Production release              ││
|  │ Released 3 days ago by alice              ││
|  │ 4 assets · 1,234 downloads               ││
|  ├──────────────────────────────────────────┤│
|  │ v2.0.0 — Major version                   ││
|  │ Released 2 weeks ago by bob              ││
|  └──────────────────────────────────────────┘|
+----------------------------------------------+
```

**Create Release dialog:**

1. Tag name input (text, with validation)
2. Release name input
3. Target branch selector (default: main)
4. "Generate changelog" button → calls `releases.generateChangelog`, populates the notes textarea
5. Notes textarea (markdown, with preview using `MarkdownBody` component)
6. Draft / Prerelease toggles
7. "Create Release" button → calls `releases.create`
8. Toast on success with link to the release on GitHub

#### 3.4.3 Deployment Pipeline Visualization (Basic)

If the repo uses GitHub Environments, show deployment status after merge.

**New IPC endpoint:**

```typescript
"deployments.list": {
  args: { cwd: string; environment?: string };
  result: Array<{
    id: number;
    environment: string;
    state: "success" | "failure" | "pending" | "in_progress" | "queued";
    sha: string;
    ref: string;
    createdAt: string;
    updatedAt: string;
    creator: { login: string };
  }>;
};
```

**Implementation:** `gh api repos/{owner}/{repo}/deployments --paginate`

**UI:** Show a simple deployment status bar at the bottom of the PR detail view (after merge):

```
Deployed: staging ●  (2m ago)  →  production ○  (pending)
```

Green dot for success, amber for pending/in_progress, red for failure. This is deliberately minimal — we're not building a full deployment dashboard, just giving visibility into where merged code is.

---

### 3.5 Smart Notifications (Enhanced)

Extend the notification system with configurability and an in-app notification center.

#### 3.5.1 Notification Preferences

**Modify:** Settings view

Add a "Notifications" section:

| Setting                 | Control                            | Default |
| ----------------------- | ---------------------------------- | ------- |
| Review requests         | Toggle                             | On      |
| CI failures on your PRs | Toggle                             | On      |
| PR approvals            | Toggle                             | On      |
| PR merged               | Toggle                             | On      |
| Mute specific repos     | Multi-select of workspaces         | None    |
| Mute specific authors   | Text input (comma-separated)       | None    |
| Quiet hours             | Time range picker (e.g., 10pm-8am) | Off     |

Store in preferences via `preferences.set`.

#### 3.5.2 Notification Center (In-App)

**New component:** `src/renderer/components/notification-center.tsx`

Behind the bell icon in the navbar. Opens as a popover/dropdown.

- List of recent notifications (last 50), stored in SQLite
- Each item: icon (by type), title, body, relative time, read/unread state
- Click to navigate to the relevant PR
- "Mark all as read" button
- Unread count shown as a badge on the bell icon in the navbar

**New IPC endpoints:**

```typescript
"notifications.list": {
  args: { limit?: number };
  result: Array<{
    id: number;
    type: "review" | "ci-fail" | "approve" | "merge";
    title: string;
    body: string;
    prNumber: number;
    workspace: string;
    read: boolean;
    createdAt: string;
  }>;
};

"notifications.markRead": {
  args: { id: number };
  result: void;
};

"notifications.markAllRead": {
  args: {};
  result: void;
};
```

**New SQLite table:**

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  pr_number INTEGER,
  workspace TEXT,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Modify:** `src/renderer/hooks/use-notification-polling.ts`

When a notification is triggered, in addition to sending the OS notification, also insert it into the SQLite notifications table via `notifications.insert` IPC.

---

## New Files Summary

| Action | File                                              | Description                                                                    |
| ------ | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| Create | `src/main/services/ai.ts`                         | AI provider adapter (OpenAI, Anthropic, Ollama via raw fetch)                  |
| Create | `src/renderer/components/metrics-view.tsx`        | Team metrics dashboard (cycle time, review load, PR size distribution)         |
| Create | `src/renderer/components/ai-explanation.tsx`      | Inline AI code explanation in diff                                             |
| Create | `src/renderer/components/ai-review-summary.tsx`   | AI-generated PR review summary                                                 |
| Create | `src/renderer/components/releases-view.tsx`       | Release list + create release dialog                                           |
| Create | `src/renderer/components/notification-center.tsx` | In-app notification history popover                                            |
| Modify | `src/main/services/gh-cli.ts`                     | Add `listAllPrs`, release functions, deployment functions                      |
| Modify | `src/shared/ipc.ts`                               | Add ~15 new endpoints (metrics, AI, releases, deployments, notifications CRUD) |
| Modify | `src/main/ipc-handler.ts`                         | Register new handlers                                                          |
| Modify | `src/main/db/database.ts`                         | Add `notifications` table                                                      |
| Modify | `src/main/db/repository.ts`                       | Add notification CRUD functions                                                |
| Modify | `src/renderer/components/pr-inbox.tsx`            | Add multi-repo toggle, consume `pr.listAll`                                    |
| Modify | `src/renderer/components/pr-detail-view.tsx`      | Add AI explanation context menu, deployment status after merge                 |
| Modify | `src/renderer/components/ci-annotation.tsx`       | Add "Explain with AI" button                                                   |
| Modify | `src/renderer/components/checks-panel.tsx`        | Add "Explain with AI" button on failed checks                                  |
| Modify | `src/renderer/components/settings-view.tsx`       | Add AI provider config + notification preferences                              |
| Modify | `src/renderer/components/navbar.tsx`              | Add Metrics tab, notification bell with unread badge                           |
| Modify | `src/renderer/lib/router.tsx`                     | Add `metrics` and `releases` routes                                            |
| Modify | `src/renderer/hooks/use-notification-polling.ts`  | Multi-repo support, persist to SQLite                                          |

## Dependencies to Install

```bash
bun add -d @types/node  # if not already present, for fetch types
```

No new runtime dependencies. The AI providers are called via raw `fetch()`. Metrics charts use plain CSS. No charting library.

---

## After Phase 3

The app will have:

- Everything from Phase 1 (PR review lifecycle) + Phase 2 (workflows, settings, notifications)
- Multi-repo unified inbox (all PRs across all workspaces)
- Team metrics (cycle time, review load, PR size trends) — computed locally
- AI-powered features: inline code explanations, PR review summaries, CI failure analysis
- Release management (list, create with changelog, basic deployment tracking)
- Smart notifications with preferences, quiet hours, and in-app notification center

**What comes after Phase 3:**

- Browser extension to redirect GitHub PR URLs to Dispatch
- Auto-update infrastructure (Electron auto-updater)
- Licensing / activation system (if going commercial)
- Public website and documentation
- Beta program with real teams
