import { execFile as execFileCb } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  type BrowserWindowConstructorOptions,
  BrowserWindow,
  Menu,
  Tray,
  app,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  session,
} from "electron";

const execFile = promisify(execFileCb);

import { BADGE_COUNT_CHANNEL } from "../shared/ipc";
import { closeDatabase, initDatabase } from "./db/database";
import { registerIpcHandler } from "./ipc-handler";
import { initAcp, shutdownAcp } from "./services/acp";
import { trackFromMain } from "./services/analytics";
import { getExternalUrl, openExternalUrl } from "./services/external-links";
import { type TrayState, startPolling, stopPolling } from "./services/tray-poller";

// ---------------------------------------------------------------------------
// Window configuration
// ---------------------------------------------------------------------------

const WINDOW_CONFIG: BrowserWindowConstructorOptions = {
  width: 1400,
  height: 900,
  minWidth: 960,
  minHeight: 660,
  show: false,
  titleBarStyle: "hiddenInset",
  trafficLightPosition: { x: 16, y: 14 },
  backgroundColor: "#08080a",
  icon: join(__dirname, "../resources/icon-256.png"),
  webPreferences: {
    preload: join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
};

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.name = "Dispatch";

let isQuitting = false;

function openExternalFromWindow(url: string): void {
  void openExternalUrl(url).catch((error) => {
    console.error("Failed to open external URL:", error);
  });
}

function configureExternalNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = getExternalUrl(url);
    if (externalUrl) {
      openExternalFromWindow(externalUrl);
    }

    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    const externalUrl = getExternalUrl(url);
    if (!externalUrl || url === win.webContents.getURL()) {
      return;
    }

    event.preventDefault();
    openExternalFromWindow(externalUrl);
  });
}

// ---------------------------------------------------------------------------
// GitHub image auth — attach tokens for enterprise avatar/image requests
// ---------------------------------------------------------------------------

/** Cache of hostname → token so we don't shell out on every image. */
const tokenCache = new Map<string, { token: string | null; fetchedAt: number }>();
const TOKEN_TTL = 300_000; // 5 min

/**
 * Map CDN / auxiliary GitHub domains to the GitHub host that `gh auth token`
 * understands.  e.g. `avatars.githubusercontent.com` → `github.com`.
 * Enterprise hosts pass through unchanged.
 */
function resolveGitHubHost(hostname: string): string {
  if (hostname.endsWith(".githubusercontent.com") || hostname === "github.com") {
    return "github.com";
  }
  return hostname;
}

async function getGhToken(host: string): Promise<string | null> {
  const cached = tokenCache.get(host);
  if (cached && Date.now() - cached.fetchedAt < TOKEN_TTL) {
    return cached.token;
  }
  try {
    const { stdout } = await execFile("gh", ["auth", "token", "--hostname", host], {
      timeout: 5000,
    });
    const token = stdout.trim() || null;
    tokenCache.set(host, { token, fetchedAt: Date.now() });
    return token;
  } catch (error) {
    // Gh auth not configured for this host — cache the miss to avoid repeated
    // Shell-outs for domains that will never have a token (e.g. third-party CDNs).
    tokenCache.set(host, { token: null, fetchedAt: Date.now() });
    const msg = String((error as Error)?.message ?? "");
    if (!msg.includes("ENOENT")) {
      trackFromMain("gh_cli_error", { subcommand: "auth", category: "token_fetch" });
    }
  }
  return null;
}

function setupImageAuth(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["https://*/*"] },
    (details, callback) => {
      // Only intercept image requests (avatars, PR body images)
      const isImage =
        details.resourceType === "image" ||
        details.url.endsWith(".png") ||
        details.url.endsWith(".jpg") ||
        details.url.endsWith(".jpeg") ||
        details.url.endsWith(".gif") ||
        details.url.endsWith(".webp") ||
        details.url.includes("/avatars/") ||
        details.url.includes("/storage/");

      if (!isImage) {
        callback({ cancel: false });
        return;
      }

      // Resolve the GitHub host for token lookup (maps CDN domains like
      // Avatars.githubusercontent.com → github.com, leaves enterprise hosts as-is).
      const url = new URL(details.url);
      const tokenHost = resolveGitHubHost(url.hostname);

      getGhToken(tokenHost)
        .then((token) => {
          if (token) {
            callback({
              cancel: false,
              requestHeaders: {
                ...details.requestHeaders,
                Authorization: `token ${token}`,
              },
            });
          } else {
            callback({ cancel: false });
          }
        })
        .catch(() => {
          callback({ cancel: false });
        });
    },
  );
}

// ---------------------------------------------------------------------------

function createWindow(): BrowserWindow {
  const win = new BrowserWindow(WINDOW_CONFIG);
  configureExternalNavigation(win);
  setupImageAuth();

  // MacOS: hide instead of quit on close (tray keeps running)
  win.on("close", (event) => {
    if (process.platform === "darwin" && !isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(join(__dirname, "../dist/index.html"));
  }

  return win;
}

// ---------------------------------------------------------------------------
// System tray — dynamic menu with live PR data
// ---------------------------------------------------------------------------

let tray: Tray | null = null;
let trayMenuSignature: string | null = null;

function setupTray(win: BrowserWindow): void {
  try {
    const icon = nativeImage.createFromPath(join(__dirname, "../resources/trayTemplate.png"));

    if (icon.isEmpty()) {
      console.warn("Tray icon loaded but is empty");
      return;
    }

    if (process.platform === "darwin") {
      icon.setTemplateImage(true);
    }

    tray = new Tray(icon);
    tray.setToolTip("Dispatch");

    // Build initial empty menu
    updateTrayMenu(win, { reviewPrs: [], authorPrs: [], lastUpdated: new Date() });

    // Start background polling — updates the menu every 60s
    startPolling((state) => {
      updateTrayMenu(win, state);
      app.setBadgeCount(state.reviewPrs.length);
    }, 60_000);
  } catch (error) {
    console.error("Failed to set up tray:", error);
  }
}

function updateTrayMenu(win: BrowserWindow, state: TrayState): void {
  if (!tray) {
    return;
  }

  const { reviewPrs, authorPrs } = state;
  const reviewCount = reviewPrs.length;

  // MacOS: show count next to tray icon
  if (process.platform === "darwin") {
    tray.setTitle(reviewCount > 0 ? `${reviewCount}` : "");
  }

  const nextSignature = getTrayMenuSignature(state);
  if (trayMenuSignature === nextSignature) {
    return;
  }
  trayMenuSignature = nextSignature;

  const menuItems: Electron.MenuItemConstructorOptions[] = [];

  // Header
  menuItems.push({ label: "Dispatch", enabled: false });
  menuItems.push({
    label:
      reviewCount > 0
        ? `${reviewCount} PR${reviewCount === 1 ? "" : "s"} need${reviewCount === 1 ? "s" : ""} your review`
        : "No pending reviews",
    enabled: false,
  });
  menuItems.push({ type: "separator" });

  // Needs Review section
  if (reviewPrs.length > 0) {
    menuItems.push({ label: "NEEDS REVIEW", enabled: false });
    for (const pr of reviewPrs.slice(0, 8)) {
      const sizeLabel = prSize(pr.additions + pr.deletions);
      menuItems.push({
        label: `#${pr.number} ${truncate(pr.title, 40)}`,
        sublabel: `${pr.author.login} · ${sizeLabel}`,
        click: () => {
          openPrInApp(win, pr.number);
        },
      });
    }
    if (reviewPrs.length > 8) {
      menuItems.push({
        label: `and ${reviewPrs.length - 8} more...`,
        click: () => {
          showAndFocusWindow(win);
        },
      });
    }
    menuItems.push({ type: "separator" });
  }

  // Your PRs section
  if (authorPrs.length > 0) {
    menuItems.push({ label: "YOUR PRS", enabled: false });
    for (const pr of authorPrs.slice(0, 5)) {
      const isFailing = pr.statusCheckRollup.some((c) => c.conclusion?.toUpperCase() === "FAILURE");
      const isApproved = pr.reviewDecision === "APPROVED";
      const allPassing = pr.statusCheckRollup.every(
        (c) => c.conclusion?.toUpperCase() === "SUCCESS" || c.conclusion === null,
      );

      let status = "◌";
      if (isFailing) {
        status = "✕";
      } else if (isApproved && allPassing) {
        status = "✓";
      } else if (isApproved) {
        status = "●";
      }

      let sublabel = pr.headRefName;
      if (isFailing) {
        sublabel = "CI failing";
      } else if (isApproved && allPassing) {
        sublabel = "Ready to merge";
      } else if (isApproved) {
        sublabel = "Approved, CI pending";
      }

      menuItems.push({
        label: `${status} #${pr.number} ${truncate(pr.title, 36)}`,
        sublabel,
        click: () => {
          openPrInApp(win, pr.number);
        },
      });
    }
    menuItems.push({ type: "separator" });
  }

  // Actions
  menuItems.push({
    label: "Open Dispatch",
    accelerator: "CommandOrControl+Shift+D",
    click: () => {
      showAndFocusWindow(win);
    },
  });
  menuItems.push({
    label: "Preferences...",
    click: () => {
      showAndFocusWindow(win);
      win.webContents.send("navigate", { view: "settings" });
    },
  });
  menuItems.push({ type: "separator" });
  menuItems.push({
    label: "Quit Dispatch",
    accelerator: "CommandOrControl+Q",
    click: () => {
      app.quit();
    },
  });

  const contextMenu = Menu.buildFromTemplate(menuItems);
  tray.setContextMenu(contextMenu);
}

function getTrayMenuSignature(state: TrayState): string {
  return JSON.stringify({
    reviewPrs: state.reviewPrs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      author: pr.author.login,
      additions: pr.additions,
      deletions: pr.deletions,
    })),
    authorPrs: state.authorPrs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRefName: pr.headRefName,
      reviewDecision: pr.reviewDecision,
      statusCheckRollup: pr.statusCheckRollup.map((check) => check.conclusion),
    })),
  });
}

function showAndFocusWindow(win: BrowserWindow): void {
  if (win.isMinimized()) {
    win.restore();
  }
  if (!win.isVisible()) {
    win.show();
  }
  win.focus();
}

function openPrInApp(win: BrowserWindow, prNumber: number): void {
  showAndFocusWindow(win);
  win.webContents.send("navigate", { view: "review", prNumber });
}

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function prSize(lines: number): string {
  if (lines < 50) {
    return "S";
  }
  if (lines < 200) {
    return "M";
  }
  if (lines < 500) {
    return "L";
  }
  return "XL";
}

// ---------------------------------------------------------------------------
// App ready
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  // Dock icon (macOS, dev mode)
  if (process.platform === "darwin") {
    const dockIcon = nativeImage.createFromPath(join(__dirname, "../resources/dock-icon.png"));
    if (!dockIcon.isEmpty()) {
      app.dock?.setIcon(dockIcon);
    }
  }

  // Initialize database
  try {
    initDatabase();
  } catch (error) {
    console.error("Failed to initialize database:", error);
    dialog.showErrorBox(
      "Database Error",
      `Dispatch failed to initialize its database.\n\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  registerIpcHandler();

  // Create main window
  const win = createWindow();

  // Initialize ACP (Agent Client Protocol) subsystem
  initAcp(win);

  // System tray with live PR data
  setupTray(win);

  // Badge count from renderer
  ipcMain.on(BADGE_COUNT_CHANNEL, (_event, count: unknown) => {
    if (typeof count === "number" && Number.isInteger(count) && count >= 0) {
      app.setBadgeCount(count);
    }
  });

  // Global shortcut: Cmd+Shift+D to open/focus Dispatch from anywhere
  globalShortcut.register("CommandOrControl+Shift+D", () => {
    const activeWin = BrowserWindow.getAllWindows()[0];
    if (activeWin) {
      showAndFocusWindow(activeWin);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      // MacOS: clicking dock icon shows the hidden window
      const activeWin = BrowserWindow.getAllWindows()[0];
      if (activeWin) {
        showAndFocusWindow(activeWin);
      }
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  stopPolling();
  globalShortcut.unregisterAll();
  void shutdownAcp();
  closeDatabase();
});

// Development hot-reload
if (process.env.VITE_DEV_SERVER_URL) {
  process.on("message", (msg) => {
    if (msg === "electron-vite&type=hot-reload") {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.reload();
      }
    }
  });
}
