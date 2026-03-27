/**
 * Session Manager — manages ACP sessions across agents and workspaces.
 *
 * One session per workspace per agent. Sessions are reused across prompts
 * for conversational context. Cleaned up on workspace switch or app quit.
 */

import type { AcpClientCallbacks } from "./client";
import type { AgentRegistry } from "./registry";
import type {
  AcpAgentInfo,
  AcpCompletionResult,
  AcpPermissionEvent,
  AcpSessionInfo,
  AcpSessionStatus,
  AcpUpdateEvent,
} from "./types";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { BrowserWindow } from "electron";

import { AcpClient } from "./client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManagedSession {
  client: AcpClient;
  sessionId: string;
  agentId: string;
  cwd: string;
  status: AcpSessionStatus;
}

type PermissionResolver = (response: { optionId: string }) => void;

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

export class SessionManager {
  private registry: AgentRegistry;
  private window: BrowserWindow | null = null;

  /** Active client connections, keyed by agentId. */
  private clients = new Map<string, AcpClient>();

  /** Active sessions, keyed by sessionId. */
  private sessions = new Map<string, ManagedSession>();

  /** Pending permission requests, keyed by requestId. */
  private pendingPermissions = new Map<string, PermissionResolver>();

  /** Text accumulator per session for simple completion results. */
  private textAccumulators = new Map<string, string>();

  constructor(registry: AgentRegistry) {
    this.registry = registry;
  }

  /** Set the main BrowserWindow for IPC events. */
  setWindow(win: BrowserWindow): void {
    this.window = win;
  }

  // -------------------------------------------------------------------------
  // Client management
  // -------------------------------------------------------------------------

  /** Get or create a connected AcpClient for an agent. */
  private async getClient(agentInfo: AcpAgentInfo): Promise<AcpClient> {
    const existing = this.clients.get(agentInfo.id);
    if (existing?.isConnected) {
      return existing;
    }

    const callbacks: AcpClientCallbacks = {
      onUpdate: (event: AcpUpdateEvent) => this.handleUpdate(event),
      onPermissionRequest: (event: AcpPermissionEvent) => this.handlePermissionRequest(event),
      onStatusChange: (agentId: string, status: string) => {
        console.log(`[acp:session-manager] Agent ${agentId} status: ${status}`);
        if (status === "disconnected" || status === "error") {
          this.clients.delete(agentId);
          // Mark all sessions for this agent as closed
          for (const [sid, session] of this.sessions) {
            if (session.agentId === agentId) {
              session.status = "closed";
              this.sessions.delete(sid);
            }
          }
        }
      },
    };

    const client = new AcpClient(agentInfo, callbacks);
    const initResponse = await client.connect();

    // Update registry with capabilities
    this.registry.updateCapabilities(agentInfo.id, initResponse.agentCapabilities ?? null);

    this.clients.set(agentInfo.id, client);
    return client;
  }

  // -------------------------------------------------------------------------
  // Session operations
  // -------------------------------------------------------------------------

  /**
   * Create a session for a workspace with a specific agent (or the default).
   * Reuses existing sessions for the same agent+cwd pair.
   */
  async createSession(cwd: string, agentId?: string): Promise<AcpSessionInfo> {
    // Find existing session for this agent+cwd
    for (const session of this.sessions.values()) {
      if (session.cwd === cwd && (agentId ? session.agentId === agentId : true)) {
        if (session.status === "ready" || session.status === "prompting") {
          return this.toSessionInfo(session);
        }
      }
    }

    // Resolve agent
    const agentInfo = agentId ? this.registry.getAgent(agentId) : this.registry.getDefaultAgent();

    if (!agentInfo) {
      throw new Error(
        agentId
          ? `Agent "${agentId}" not found`
          : "No ACP agent available. Install an agent or configure one in Settings.",
      );
    }

    if (!agentInfo.available) {
      throw new Error(`Agent "${agentInfo.name}" is not available. Check its binary path.`);
    }

    // Connect and create session
    const client = await this.getClient(agentInfo);
    const sessionId = await client.createSession(cwd);

    const managed: ManagedSession = {
      client,
      sessionId,
      agentId: agentInfo.id,
      cwd,
      status: "ready",
    };

    this.sessions.set(sessionId, managed);
    return this.toSessionInfo(managed);
  }

  /**
   * Send a prompt to a session. Returns the final result when the agent finishes.
   * Streaming updates are sent to the renderer via the acp:update channel.
   */
  async prompt(sessionId: string, content: ContentBlock[]): Promise<{ stopReason: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    session.status = "prompting";
    this.textAccumulators.set(sessionId, "");

    try {
      const result = await session.client.prompt(sessionId, content);
      session.status = "ready";
      return result;
    } catch (error) {
      session.status = "error";
      throw error;
    }
  }

  /**
   * Send a text prompt and collect the full text response.
   * This is the simple path for replacing ai.complete — send text, get text back.
   */
  async complete(cwd: string, text: string, agentId?: string): Promise<AcpCompletionResult> {
    const session = await this.createSession(cwd, agentId);

    this.textAccumulators.set(session.sessionId, "");

    const content: ContentBlock[] = [{ type: "text", text }];
    const result = await this.prompt(session.sessionId, content);

    const accumulatedText = this.textAccumulators.get(session.sessionId) ?? "";
    this.textAccumulators.delete(session.sessionId);

    return {
      text: accumulatedText,
      stopReason: result.stopReason as AcpCompletionResult["stopReason"],
    };
  }

  /** Cancel an in-progress prompt. */
  async cancel(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    await session.client.cancel(sessionId);
  }

  /** Close a session. */
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = "closed";
      this.sessions.delete(sessionId);
    }
  }

  /** List all active sessions. */
  listSessions(): AcpSessionInfo[] {
    return [...this.sessions.values()].map((s) => this.toSessionInfo(s));
  }

  /** Resolve a pending permission request. */
  resolvePermission(requestId: string, optionId: string): void {
    const resolver = this.pendingPermissions.get(requestId);
    if (resolver) {
      resolver({ optionId });
      this.pendingPermissions.delete(requestId);
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /** Disconnect all agents and close all sessions. */
  async shutdownAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.status = "closed";
    }
    this.sessions.clear();

    const disconnections = [...this.clients.values()].map((c) => c.disconnect());
    await Promise.allSettled(disconnections);
    this.clients.clear();
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private handleUpdate(event: AcpUpdateEvent): void {
    // Accumulate text for simple completion
    if (event.update.sessionUpdate === "agent_message_chunk") {
      const chunk = event.update;
      if (chunk.content.type === "text") {
        const current = this.textAccumulators.get(event.sessionId) ?? "";
        this.textAccumulators.set(event.sessionId, current + chunk.content.text);
      }
    }

    // Forward to renderer
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("acp:update", event);
    }
  }

  private handlePermissionRequest(event: AcpPermissionEvent): Promise<{ optionId: string }> {
    return new Promise<{ optionId: string }>((resolve) => {
      this.pendingPermissions.set(event.requestId, resolve);

      // Forward to renderer
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send("acp:permission", event);
      } else {
        // No window — auto-reject
        const rejectOption = event.options.find((o) => o.kind === "reject_once");
        resolve({ optionId: rejectOption?.optionId ?? event.options[0]?.optionId ?? "" });
      }
    });
  }

  private toSessionInfo(session: ManagedSession): AcpSessionInfo {
    return {
      sessionId: session.sessionId,
      agentId: session.agentId,
      cwd: session.cwd,
      status: session.status,
    };
  }
}
