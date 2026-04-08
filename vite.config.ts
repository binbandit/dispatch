/// <reference types="vitest/config" />
import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";

interface ElectronStartup {
  (...args: unknown[]): Promise<void>;
  exit?: () => Promise<void>;
}

let devElectronShutdownHooksInstalled = false;
let devElectronShutdownPromise: Promise<void> | null = null;

function stopDevElectron(startup: ElectronStartup): Promise<void> {
  if (devElectronShutdownPromise) {
    return devElectronShutdownPromise;
  }

  devElectronShutdownPromise = Promise.resolve(startup.exit?.()).finally(() => {
    devElectronShutdownPromise = null;
  });

  return devElectronShutdownPromise;
}

function installDevElectronShutdownHooks(startup: ElectronStartup): void {
  if (devElectronShutdownHooksInstalled) {
    return;
  }

  devElectronShutdownHooksInstalled = true;

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const forwardSignal = (): void => {
      process.removeListener(signal, forwardSignal);
      void stopDevElectron(startup).finally(() => {
        process.kill(process.pid, signal);
      });
    };

    process.once(signal, forwardSignal);
  }

  process.stdin.once("end", () => {
    void stopDevElectron(startup);
  });
}

export default defineConfig({
  clearScreen: false,
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: "src/main/index.ts",
        onstart: async ({ startup }) => {
          installDevElectronShutdownHooks(startup);
          await startup();
        },
        vite: {
          clearScreen: false,
          build: {
            rollupOptions: {
              external: ["better-sqlite3"],
            },
          },
        },
      },
      preload: {
        input: "src/preload/index.ts",
        vite: {
          clearScreen: false,
          build: {
            rollupOptions: {
              output: {
                entryFileNames: "preload.js",
              },
            },
          },
        },
      },
    }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist", "dist-electron"],
    passWithNoTests: true,
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
