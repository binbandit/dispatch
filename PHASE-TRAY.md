# Phase: Tray Icon — Make It Useful

## Problem

The tray icon exists in the macOS menu bar but does nothing. No click handler, no menu, no dynamic state. It's visual bloat. Either make it earn its place or remove it.

This spec makes it earn its place.

---

## What the Tray Should Do

The tray icon is Dispatch's **always-visible presence** — even when the window is closed or minimized. It answers the question: "Do I need to open Dispatch right now?"

Three jobs:

1. **Glanceable status** — see at a glance if you have pending reviews or CI failures, without opening the app
2. **Quick actions** — approve a simple PR, re-run CI, or open a specific PR directly from the menu bar
3. **Background awareness** — the app polls for changes even when the window is closed, and the tray reflects the current state

---

## Implementation

### 1. Tray Click → Context Menu

**Modify:** `src/main/index.ts`

Replace the static `setupTray()` with a dynamic tray that builds its menu from live data.

The tray menu structure:

```
─────────────────────────────
  Dispatch                    (header, disabled)
  3 PRs need your review      (status line, disabled)
─────────────────────────────
  NEEDS REVIEW
  ● #847 feat: streaming      → Open in Dispatch
  ● #832 fix: race condition  → Open in Dispatch
  ● #819 refactor: auth       → Open in Dispatch
─────────────────────────────
  YOUR PRS
  ✕ #841 migrate to v2        CI failing — Re-run
  ✓ #838 bump deps            Ready to merge
─────────────────────────────
  Open Dispatch               (brings window to front)
  Preferences...              (opens settings view)
─────────────────────────────
  Quit Dispatch
─────────────────────────────
```

**How it works:**

The main process runs a background polling loop (independent of the renderer). Every 60 seconds, it calls `gh pr list` to get the user's review-requested and authored PRs. It builds the tray menu from this data.

This is the key architectural point: **the tray polls independently from the renderer.** The renderer may be closed/hidden. The tray keeps running.

### 2. Background Polling in Main Process

**New file:** `src/main/services/tray-poller.ts`

```typescript
import type { GhPrListItem } from "../../shared/ipc";
import { listPrs } from "./gh-cli";
import { getActiveWorkspace, getWorkspaces } from "../db/repository";

export interface TrayState {
  reviewPrs: GhPrListItem[];
  authorPrs: GhPrListItem[];
  lastUpdated: Date;
}

let state: TrayState = {
  reviewPrs: [],
  authorPrs: [],
  lastUpdated: new Date(),
};

let pollInterval: ReturnType<typeof setInterval> | null = null;

export function getTrayState(): TrayState {
  return state;
}

export async function pollOnce(): Promise<TrayState> {
  const activePath = getActiveWorkspace();
  if (!activePath) {
    // No workspace configured — try the first one
    const workspaces = getWorkspaces();
    if (workspaces.length === 0) return state;
    // Use the first workspace
    const cwd = workspaces[0].path;
    return pollForCwd(cwd);
  }
  return pollForCwd(activePath);
}

async function pollForCwd(cwd: string): Promise<TrayState> {
  try {
    const [reviewPrs, authorPrs] = await Promise.all([
      listPrs(cwd, "reviewRequested"),
      listPrs(cwd, "authored"),
    ]);
    state = { reviewPrs, authorPrs, lastUpdated: new Date() };
  } catch {
    // Silently fail — don't break the tray if gh is unavailable
  }
  return state;
}

export function startPolling(onUpdate: (state: TrayState) => void, intervalMs = 60_000): void {
  // Immediate first poll
  pollOnce()
    .then(onUpdate)
    .catch(() => {});

  pollInterval = setInterval(() => {
    pollOnce()
      .then(onUpdate)
      .catch(() => {});
  }, intervalMs);
}

export function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
```

### 3. Dynamic Tray Menu Builder

**Modify:** `src/main/index.ts` — rewrite `setupTray()`

```typescript
import { Menu, Tray, nativeImage, BrowserWindow, app } from "electron";
import { startPolling, stopPolling, type TrayState } from "./services/tray-poller";

let tray: Tray | null = null;

function setupTray(mainWindow: BrowserWindow): void {
  try {
    const icon = nativeImage.createFromPath(join(__dirname, "../resources/trayTemplate.png"));

    if (icon.isEmpty()) {
      console.warn("Tray icon is empty");
      return;
    }

    if (process.platform === "darwin") {
      icon.setTemplateImage(true);
    }

    tray = new Tray(icon);
    tray.setToolTip("Dispatch");

    // Build initial empty menu
    updateTrayMenu(mainWindow, {
      reviewPrs: [],
      authorPrs: [],
      lastUpdated: new Date(),
    });

    // Start background polling — updates the menu every 60s
    startPolling((state) => {
      updateTrayMenu(mainWindow, state);

      // Also update the dock badge
      app.setBadgeCount(state.reviewPrs.length);
    }, 60_000);
  } catch (error) {
    console.error("Failed to set up tray:", error);
  }
}

function updateTrayMenu(mainWindow: BrowserWindow, state: TrayState): void {
  if (!tray) return;

  const { reviewPrs, authorPrs } = state;
  const reviewCount = reviewPrs.length;
  const failingCount = authorPrs.filter((pr) =>
    pr.statusCheckRollup.some((c) => c.conclusion === "failure"),
  ).length;

  // Update the tray title (macOS shows this next to the icon)
  if (process.platform === "darwin") {
    tray.setTitle(reviewCount > 0 ? `${reviewCount}` : "");
  }

  const menuItems: Electron.MenuItemConstructorOptions[] = [];

  // ── Header ──
  menuItems.push({
    label: "Dispatch",
    enabled: false,
  });

  if (reviewCount > 0) {
    menuItems.push({
      label: `${reviewCount} PR${reviewCount === 1 ? "" : "s"} need${reviewCount === 1 ? "s" : ""} your review`,
      enabled: false,
    });
  } else {
    menuItems.push({
      label: "No pending reviews",
      enabled: false,
    });
  }

  menuItems.push({ type: "separator" });

  // ── Needs Review section ──
  if (reviewPrs.length > 0) {
    menuItems.push({
      label: "NEEDS REVIEW",
      enabled: false,
    });

    for (const pr of reviewPrs.slice(0, 8)) {
      const sizeLabel = prSize(pr.additions + pr.deletions);
      menuItems.push({
        label: `#${pr.number} ${truncate(pr.title, 40)}`,
        sublabel: `${pr.author.login} · ${sizeLabel}`,
        click: () => {
          openPrInApp(mainWindow, pr.number);
        },
      });
    }

    if (reviewPrs.length > 8) {
      menuItems.push({
        label: `and ${reviewPrs.length - 8} more...`,
        click: () => {
          showAndFocusWindow(mainWindow);
        },
      });
    }

    menuItems.push({ type: "separator" });
  }

  // ── Your PRs section ──
  if (authorPrs.length > 0) {
    menuItems.push({
      label: "YOUR PRS",
      enabled: false,
    });

    for (const pr of authorPrs.slice(0, 5)) {
      const isFailing = pr.statusCheckRollup.some((c) => c.conclusion === "failure");
      const isApproved = pr.reviewDecision === "APPROVED";
      const allPassing = pr.statusCheckRollup.every(
        (c) => c.conclusion === "success" || c.conclusion === null,
      );

      let status = "◌";
      if (isFailing) status = "✕";
      else if (isApproved && allPassing) status = "✓";
      else if (isApproved) status = "●";

      let sublabel = pr.headRefName;
      if (isFailing) sublabel = "CI failing";
      else if (isApproved && allPassing) sublabel = "Ready to merge";
      else if (isApproved) sublabel = "Approved, CI pending";

      menuItems.push({
        label: `${status} #${pr.number} ${truncate(pr.title, 36)}`,
        sublabel,
        click: () => {
          openPrInApp(mainWindow, pr.number);
        },
      });
    }

    menuItems.push({ type: "separator" });
  }

  // ── Actions ──
  menuItems.push({
    label: "Open Dispatch",
    accelerator: "CommandOrControl+Shift+D",
    click: () => {
      showAndFocusWindow(mainWindow);
    },
  });

  menuItems.push({
    label: "Preferences...",
    click: () => {
      showAndFocusWindow(mainWindow);
      mainWindow.webContents.send("navigate", { view: "settings" });
    },
  });

  menuItems.push({ type: "separator" });

  menuItems.push({
    label: `Quit Dispatch`,
    accelerator: "CommandOrControl+Q",
    click: () => {
      app.quit();
    },
  });

  const contextMenu = Menu.buildFromTemplate(menuItems);
  tray.setContextMenu(contextMenu);
}

function showAndFocusWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

function openPrInApp(win: BrowserWindow, prNumber: number): void {
  showAndFocusWindow(win);
  win.webContents.send("navigate", { view: "review", prNumber });
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function prSize(lines: number): string {
  if (lines < 50) return "S";
  if (lines < 200) return "M";
  if (lines < 500) return "L";
  return "XL";
}
```

### 4. Renderer Listening for Tray Navigation

The tray sends `navigate` events to the renderer via `webContents.send`. The renderer needs to listen.

**Modify:** `src/preload/index.ts`

Add an event listener bridge:

```typescript
contextBridge.exposeInMainWorld("api", {
  invoke(method: string, args: unknown): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNEL, { method, args });
  },

  setBadgeCount(count: number): void {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return;
    ipcRenderer.send(BADGE_COUNT_CHANNEL, count);
  },

  // NEW: Listen for navigation events from main process (tray menu clicks)
  onNavigate(callback: (route: { view: string; prNumber?: number }) => void): () => void {
    const handler = (_event: unknown, route: { view: string; prNumber?: number }) => {
      callback(route);
    };
    ipcRenderer.on("navigate", handler);
    return () => ipcRenderer.removeListener("navigate", handler);
  },
});
```

**Modify:** `src/preload/env.d.ts`

Add the type:

```typescript
interface DispatchAPI {
  invoke(method: string, args: unknown): Promise<unknown>;
  setBadgeCount(count: number): void;
  onNavigate(callback: (route: { view: string; prNumber?: number }) => void): () => void;
}
```

**Modify:** `src/renderer/components/app-layout.tsx`

Listen for tray navigation events:

```typescript
useEffect(() => {
  const cleanup = window.api.onNavigate((route) => {
    if (route.view === "settings") {
      navigate({ view: "settings" });
    } else if (route.view === "review" && route.prNumber) {
      navigate({ view: "review", prNumber: route.prNumber });
    }
  });
  return cleanup;
}, [navigate]);
```

### 5. Tray Count Badge (macOS)

On macOS, the tray can show a small count next to the icon using `tray.setTitle("3")`. This is already handled in the `updateTrayMenu` function above.

The count shows the number of PRs needing review. When it's 0, the title is cleared (no number shown).

### 6. Global Shortcut to Open Dispatch

**Modify:** `src/main/index.ts`

Register a global keyboard shortcut to bring Dispatch to the front from anywhere:

```typescript
import { globalShortcut } from "electron";

app.whenReady().then(() => {
  // ... existing setup ...

  // Global shortcut: Cmd+Shift+D to open/focus Dispatch
  globalShortcut.register("CommandOrControl+Shift+D", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      showAndFocusWindow(win);
    }
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
```

This means: even when you're in VS Code, Chrome, or Terminal, hit `Cmd+Shift+D` and Dispatch comes to the front. The tray menu also shows this accelerator so users discover it.

### 7. Keep Alive When Window Closes (macOS)

On macOS, closing the window should NOT quit the app. The tray should keep running in the background, polling and updating.

**Modify:** `src/main/index.ts` — window creation:

```typescript
function createWindow(): BrowserWindow {
  const win = new BrowserWindow(WINDOW_CONFIG);

  // macOS: hide the window instead of quitting when the user closes it
  win.on("close", (event) => {
    if (process.platform === "darwin" && !app.isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  // ... rest of window setup
}

// Track whether we're actually quitting
app.on("before-quit", () => {
  (app as any).isQuitting = true;
  stopPolling();
  closeDatabase();
});
```

Now when the user hits `Cmd+W`, the window hides but the tray stays alive. Click the tray menu → "Open Dispatch" (or `Cmd+Shift+D`) to bring it back.

---

## Cleanup: Remove If Not Useful

If for some reason this spec is too much — if the tray doesn't add enough value — remove the tray entirely rather than shipping dead UI. Add this to `setupTray`:

```typescript
// If the tray isn't pulling its weight, remove it:
// tray = null;
// return;
```

The principle: every pixel of UI must earn its place. A tray icon that does nothing is worse than no tray icon.

---

## Files Summary

| Action | File                                     | Description                                                                   |
| ------ | ---------------------------------------- | ----------------------------------------------------------------------------- |
| Create | `src/main/services/tray-poller.ts`       | Background PR polling for tray (independent of renderer)                      |
| Modify | `src/main/index.ts`                      | Rewrite `setupTray()` with dynamic menu, global shortcut, keep-alive on close |
| Modify | `src/preload/index.ts`                   | Add `onNavigate` event bridge                                                 |
| Modify | `src/preload/env.d.ts`                   | Add `onNavigate` type                                                         |
| Modify | `src/renderer/components/app-layout.tsx` | Listen for tray navigation events                                             |

## Dependencies

None. Uses only Electron APIs (`Tray`, `Menu`, `globalShortcut`, `nativeImage`) and existing `gh-cli.ts` functions.

---

## Result

After this phase, the tray icon:

1. **Shows a live count** of PRs needing review (next to the icon on macOS)
2. **Click opens a menu** with your pending reviews and your own PRs with CI status
3. **Click any PR** to open it directly in Dispatch
4. **Shows CI status** on your PRs (failing, approved, ready to merge)
5. **"Open Dispatch"** brings the window to front, with `Cmd+Shift+D` global shortcut
6. **"Preferences..."** opens settings
7. **Keeps running** when you close the window (macOS) — polls in the background
8. **Updates every 60 seconds** independently of the renderer
