import { join } from "node:path";

import {
  type BrowserWindowConstructorOptions,
  Tray,
  app,
  ipcMain,
  nativeImage,
  BrowserWindow,
} from "electron";

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
// System tray
// ---------------------------------------------------------------------------

function setupTray(): void {
  // 16x16 copper-tinted icon as a simple data URL
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWklEQVQ4T2P8z8DwHwMNACMDAwMjNQwYZGb8/88A1UENLzAykmIAvS0g2gCaewGnF4hxMU29QIwBNPcCIxkG0DwOGBkYaOsFogygpReINoDmgURzA2juBSINAACXizARd37XYAAAAABJRU5ErkJggg==",
  );
  const tray = new Tray(icon);
  tray.setToolTip("Dispatch");
}

app.whenReady().then(() => {
  // Initialize infrastructure
  initDatabase();
  registerIpcHandler();

  // Create main window
  createWindow();

  // System tray (macOS dock badge is handled via app.setBadgeCount)
  setupTray();

  // Listen for badge count updates from renderer
  ipcMain.on("set-badge-count", (_event, count: number) => {
    app.setBadgeCount(count);
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

process.on("message", (msg) => {
  if (msg === "electron-vite&type=hot-reload") {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.reload();
    }
  }
});
