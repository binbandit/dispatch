/**
 * ACP (Agent Client Protocol) integration — public API.
 *
 * Provides a singleton interface for the IPC handler to interact with
 * ACP agents. Manages the registry and session manager lifecycle.
 */

import type { BrowserWindow } from "electron";

import { AgentRegistry } from "./registry";
import { SessionManager } from "./session-manager";

export type {
  AcpAgentInfo,
  AcpCompletionResult,
  AcpPermissionEvent,
  AcpSessionInfo,
  AcpUpdateEvent,
} from "./types";

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

let registry: AgentRegistry | null = null;
let sessionManager: SessionManager | null = null;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/** Initialize the ACP subsystem. Call once during app startup. */
export function initAcp(window: BrowserWindow): void {
  registry = new AgentRegistry();
  registry.loadSavedConfigs();

  sessionManager = new SessionManager(registry);
  sessionManager.setWindow(window);
}

/** Update the BrowserWindow reference (e.g. after window recreation). */
export function setAcpWindow(window: BrowserWindow): void {
  sessionManager?.setWindow(window);
}

// ---------------------------------------------------------------------------
// Registry operations
// ---------------------------------------------------------------------------

export function getRegistry(): AgentRegistry {
  if (!registry) {
    throw new Error("ACP not initialized. Call initAcp() first.");
  }
  return registry;
}

export function getSessionManager(): SessionManager {
  if (!sessionManager) {
    throw new Error("ACP not initialized. Call initAcp() first.");
  }
  return sessionManager;
}

/** Check if any ACP agent is available. */
export function hasAcpAgent(): boolean {
  return registry?.getDefaultAgent() !== null;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/** Shutdown all ACP connections. Call during app quit. */
export async function shutdownAcp(): Promise<void> {
  await sessionManager?.shutdownAll();
}
