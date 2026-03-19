import { join } from "node:path";

import {
  type BrowserWindowConstructorOptions,
  Tray,
  app,
  dialog,
  ipcMain,
  nativeImage,
  BrowserWindow,
} from "electron";

import { BADGE_COUNT_CHANNEL } from "../shared/ipc";
import { closeDatabase, initDatabase } from "./db/database";
import { registerIpcHandler } from "./ipc-handler";

// ---------------------------------------------------------------------------
// Window configuration
// ---------------------------------------------------------------------------

const WINDOW_CONFIG: BrowserWindowConstructorOptions = {
  width: 1200,
  height: 800,
  minWidth: 800,
  minHeight: 600,
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

function createWindow(): BrowserWindow {
  const win = new BrowserWindow(WINDOW_CONFIG);

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
// System tray (stored at module level to prevent GC)
// ---------------------------------------------------------------------------

let tray: Tray | null = null;

function setupTray(): void {
  try {
    const icon = nativeImage.createFromPath(join(__dirname, "../resources/trayTemplate.png"));

    if (icon.isEmpty()) {
      // eslint-disable-next-line no-console
      console.warn("Tray icon loaded but is empty — check resources/trayTemplate.png");
      return;
    }

    // On macOS, template images auto-tint to match the menu bar (dark/light)
    if (process.platform === "darwin") {
      icon.setTemplateImage(true);
    }

    tray = new Tray(icon);
    tray.setToolTip("Dispatch");
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to set up tray icon:", error);
  }
}

app.whenReady().then(() => {
  // Set dock icon on macOS (required for dev mode — production uses the .icns in the app bundle)
  if (process.platform === "darwin") {
    const dockIcon = nativeImage.createFromPath(join(__dirname, "../resources/dock-icon.png"));
    if (!dockIcon.isEmpty()) {
      app.dock?.setIcon(dockIcon);
    }
  }

  // Initialize infrastructure
  try {
    initDatabase();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to initialize database:", error);
    dialog.showErrorBox(
      "Database Error",
      `Dispatch failed to initialize its database. The app may not function correctly.\n\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  registerIpcHandler();

  // Create main window
  createWindow();

  // System tray (macOS dock badge is handled via app.setBadgeCount)
  setupTray();

  // Listen for badge count updates from renderer
  ipcMain.on(BADGE_COUNT_CHANNEL, (_event, count: unknown) => {
    if (typeof count === "number" && Number.isInteger(count) && count >= 0) {
      app.setBadgeCount(count);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
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
