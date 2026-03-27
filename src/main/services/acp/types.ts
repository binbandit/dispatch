/**
 * Local ACP types for Dispatch.
 *
 * Re-exports SDK protocol types and defines Dispatch-specific types
 * for agent registry, session management, and IPC bridging.
 */

import type {
  AgentCapabilities,
  InitializeResponse,
  SessionNotification,
  StopReason,
} from "@agentclientprotocol/sdk";

// Re-export SDK types used across the ACP layer
export type {
  AgentCapabilities,
  InitializeResponse,
  SessionNotification,
  SessionUpdate,
  StopReason,
} from "@agentclientprotocol/sdk";

// ---------------------------------------------------------------------------
// Agent registry types
// ---------------------------------------------------------------------------

/** Known ACP adapter binary names and how to launch them. */
export interface AgentBinarySpec {
  /** Unique key for this agent type (e.g. "claude", "codex"). */
  key: string;
  /** Human-readable name. */
  name: string;
  /** Binary names to search for in PATH (tried in order). */
  binaries: string[];
  /** If the binary is an npm package, the package name for npx fallback. */
  npmPackage?: string;
}

/** A discovered or user-configured agent. */
export interface AcpAgentInfo {
  /** Unique identifier (matches AgentBinarySpec.key or user-defined). */
  id: string;
  /** Display name. */
  name: string;
  /** Absolute path to the binary, or null if using npx. */
  binaryPath: string | null;
  /** Npm package name (for npx fallback). */
  npmPackage?: string;
  /** Whether the binary was found and is launchable. */
  available: boolean;
  /** Capabilities reported after initialize (null until first connection). */
  capabilities: AgentCapabilities | null;
  /** Agent info from initialize response. */
  agentInfo: InitializeResponse["agentInfo"] | null;
}

/** Persisted user configuration for an agent. */
export interface AgentConfig {
  /** Agent id. */
  id: string;
  /** Override binary path (null = auto-discover). */
  binaryPath: string | null;
  /** Whether this agent is enabled. */
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

export type AcpSessionStatus = "initializing" | "ready" | "prompting" | "closed" | "error";

export interface AcpSessionInfo {
  /** Session ID from the agent. */
  sessionId: string;
  /** Agent ID this session belongs to. */
  agentId: string;
  /** Working directory for this session. */
  cwd: string;
  /** Current status. */
  status: AcpSessionStatus;
}

// ---------------------------------------------------------------------------
// IPC bridge types (sent renderer <-> main)
// ---------------------------------------------------------------------------

/** Streamed to renderer via the acp:update channel. */
export interface AcpUpdateEvent {
  sessionId: string;
  update: SessionNotification["update"];
}

/** Streamed to renderer when agent requests permission. */
export interface AcpPermissionEvent {
  requestId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  options: Array<{
    optionId: string;
    name: string;
    kind: string;
  }>;
}

/** Result of a prompt turn. */
export interface AcpPromptResult {
  stopReason: StopReason;
}

/** Combined text from all agent_message_chunk updates. */
export interface AcpCompletionResult {
  text: string;
  stopReason: StopReason;
}
