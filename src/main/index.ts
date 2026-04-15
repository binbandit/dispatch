/* eslint-disable no-console -- The Electron main process logs startup and integration failures for local debugging. */
import { join } from "node:path";

import {
  type MenuItemConstructorOptions,
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

import {
  AI_REWRITE_SELECTION_CHANNEL,
  BADGE_COUNT_CHANNEL,
  WINDOW_STATE_CHANNEL,
  type WindowState,
} from "../shared/ipc";
import { closeDatabase, initDatabase } from "./db/database";
import { registerIpcHandler } from "./ipc-handler";
import { trackFromMain } from "./services/analytics";
import { getExternalUrl, openExternalUrl } from "./services/external-links";
import { fixPath } from "./services/fix-path";
import { execFile } from "./services/shell";
import { type TrayState, startPolling, stopPolling } from "./services/tray-poller";
import { showAndFocusWindow } from "./services/window";

// Resolve the user's full shell PATH so spawned tools (gh, git) are found.
// Must run before any child process spawning.
fixPath();

// ---------------------------------------------------------------------------
// Window configuration
// ---------------------------------------------------------------------------

const APP_DISPLAY_NAME = "Dispatch";

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

app.setName(APP_DISPLAY_NAME);

function configureApplicationMenu(): void {
  if (process.platform !== "darwin") {
    return;
  }

  const applicationMenu = Menu.buildFromTemplate([
    {
      label: APP_DISPLAY_NAME,
      submenu: [
        {
          label: `About ${APP_DISPLAY_NAME}`,
          role: "about",
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        {
          label: `Hide ${APP_DISPLAY_NAME}`,
          role: "hide",
        },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        {
          accelerator: "Command+Q",
          label: `Quit ${APP_DISPLAY_NAME}`,
          click: () => {
            app.quit();
          },
        },
      ],
    },
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]);

  Menu.setApplicationMenu(applicationMenu);
}

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

function configureEditableContextMenu(win: BrowserWindow): void {
  win.webContents.on("context-menu", (event, params) => {
    if (!params.isEditable) {
      return;
    }

    event.preventDefault();

    const hasSelection = params.selectionText.trim().length > 0;
    const menuItems: MenuItemConstructorOptions[] = [
      { role: "undo", enabled: params.editFlags.canUndo },
      { role: "redo", enabled: params.editFlags.canRedo },
      { type: "separator" },
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { role: "delete", enabled: params.editFlags.canDelete },
    ];

    if (process.platform === "darwin") {
      menuItems.push({ role: "pasteAndMatchStyle", enabled: params.editFlags.canPaste });
    }

    if (hasSelection) {
      menuItems.push(
        { type: "separator" },
        {
          label: "Rewrite with AI",
          click: () => {
            win.webContents.send(AI_REWRITE_SELECTION_CHANNEL);
          },
        },
      );
    }

    menuItems.push(
      { type: "separator" },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    );

    Menu.buildFromTemplate(menuItems).popup({ window: win });
  });
}

// ---------------------------------------------------------------------------
// GitHub media auth — attach tokens for avatar, image, and video requests
// ---------------------------------------------------------------------------

/** Cache of hostname → token so we don't shell out on every request. */
const tokenCache = new Map<string, { token: string | null; fetchedAt: number }>();
// 5 minutes.
const TOKEN_TTL = 300_000;

/**
 * Map CDN / auxiliary GitHub domains to the GitHub host that `gh auth token`
 * understands.  e.g. `avatars.githubusercontent.com` → `github.com`.
 * Enterprise hosts pass through unchanged.
 */
function resolveGitHubHost(hostname: string): string {
  const normalized = hostname.toLowerCase();
  const isGitHubCdnHost =
    normalized === "github.com" ||
    normalized.endsWith(".github.com") ||
    normalized.endsWith(".githubusercontent.com") ||
    normalized.endsWith(".githubassets.com") ||
    (normalized.endsWith(".amazonaws.com") && normalized.includes("github"));

  if (isGitHubCdnHost) {
    return "github.com";
  }
  return hostname;
}

function isGitHubMediaRequest(resourceType: string, url: URL): boolean {
  const path = url.pathname.toLowerCase();
  const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp"];
  const videoExtensions = [".mp4", ".mov", ".webm", ".m4v", ".mkv", ".avi"];
  const isMediaResourceType = resourceType === "image" || resourceType === "media";
  const hasMediaExtension = [...imageExtensions, ...videoExtensions].some((extension) =>
    path.endsWith(extension),
  );

  return (
    isMediaResourceType ||
    hasMediaExtension ||
    path.includes("/avatars/") ||
    path.includes("/storage/") ||
    path.includes("/user-attachments/")
  );
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
      trackFromMain("gh_cli_error", {
        subcommand: "auth",
        category: "token_fetch",
      });
    }
  }
  return null;
}

function setupMediaAuth(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["https://*/*"] },
    (details, callback) => {
      let targetUrl: URL;
      try {
        targetUrl = new URL(details.url);
      } catch {
        callback({ cancel: false });
        return;
      }

      const isMedia = isGitHubMediaRequest(details.resourceType, targetUrl);

      if (!isMedia) {
        callback({ cancel: false });
        return;
      }

      // Resolve the GitHub host for token lookup (maps CDN domains like
      // Avatars.githubusercontent.com → github.com, leaves enterprise hosts as-is).
      const tokenHost = resolveGitHubHost(targetUrl.hostname);

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
  configureEditableContextMenu(win);
  setupMediaAuth();

  const getWindowState = (): WindowState => ({
    isFullscreen: win.isFullScreen() || (process.platform === "darwin" && win.isSimpleFullScreen()),
  });

  const emitWindowState = (): void => {
    win.webContents.send(WINDOW_STATE_CHANNEL, getWindowState());
  };

  // MacOS: hide instead of quit on close (tray keeps running)
  win.on("close", (event) => {
    if (process.platform === "darwin" && !isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("enter-full-screen", emitWindowState);
  win.on("leave-full-screen", emitWindowState);
  win.on("maximize", emitWindowState);
  win.on("unmaximize", emitWindowState);
  win.on("resize", emitWindowState);
  win.on("restore", emitWindowState);
  win.on("show", emitWindowState);
  win.webContents.on("did-finish-load", emitWindowState);

  win.once("ready-to-show", () => {
    win.show();
    emitWindowState();
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
    updateTrayMenu(win, {
      reviewPrs: [],
      authorPrs: [],
      lastUpdated: new Date(),
    });

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

  const menuItems: Electron.MenuItemConstructorOptions[] = [
    { label: "Dispatch", enabled: false },
    {
      label:
        reviewCount > 0
          ? `${reviewCount} PR${reviewCount === 1 ? "" : "s"} need${reviewCount === 1 ? "s" : ""} your review`
          : "No pending reviews",
      enabled: false,
    },
    { type: "separator" },
  ];

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
      const isApproved = pr.reviewDecision === "APPROVED";

      let status = "◌";
      if (isApproved) {
        status = "●";
      }

      let sublabel = pr.headRefName;
      if (isApproved) {
        sublabel = "Approved";
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
    })),
  });
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
  configureApplicationMenu();

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
    const [activeWin] = BrowserWindow.getAllWindows();
    if (activeWin) {
      showAndFocusWindow(activeWin);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      // MacOS: clicking dock icon shows the hidden window
      const [activeWin] = BrowserWindow.getAllWindows();
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
