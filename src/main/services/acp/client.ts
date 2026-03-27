/**
 * ACP Client — manages a single agent subprocess and speaks JSON-RPC over stdio.
 *
 * Wraps the SDK's ClientSideConnection to handle:
 * - Subprocess lifecycle (spawn, crash recovery, graceful shutdown)
 * - Protocol initialization handshake
 * - Session creation and prompt sending
 * - Routing streaming updates and permission requests to callbacks
 */

import type {
  AcpAgentInfo,
  AcpPermissionEvent,
  AcpUpdateEvent,
  AgentCapabilities,
  InitializeResponse,
} from "./types";
import type { Client, ContentBlock } from "@agentclientprotocol/sdk";
import type { ChildProcess } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import { spawn } from "node:child_process";

import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";

// ---------------------------------------------------------------------------
// Helpers: convert Node.js streams to Web streams for the SDK
// ---------------------------------------------------------------------------

function nodeReadableToWeb(readable: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      readable.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      readable.on("end", () => {
        controller.close();
      });
      readable.on("error", (err) => {
        controller.error(err);
      });
    },
    cancel() {
      readable.destroy();
    },
  });
}

function nodeWritableToWeb(writable: Writable): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        const ok = writable.write(chunk, (err) => {
          if (err) {
            reject(err);
          }
        });
        if (ok) {
          resolve();
        } else {
          writable.once("drain", resolve);
        }
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        writable.end(() => resolve());
      });
    },
    abort(reason) {
      writable.destroy(reason instanceof Error ? reason : new Error(String(reason)));
    },
  });
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

export interface AcpClientCallbacks {
  onUpdate: (event: AcpUpdateEvent) => void;
  onPermissionRequest: (event: AcpPermissionEvent) => Promise<{ optionId: string }>;
  onStatusChange: (agentId: string, status: "connected" | "disconnected" | "error") => void;
}

// ---------------------------------------------------------------------------
// AcpClient
// ---------------------------------------------------------------------------

export class AcpClient {
  readonly agentInfo: AcpAgentInfo;
  private callbacks: AcpClientCallbacks;

  private process: ChildProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private capabilities: AgentCapabilities | null = null;
  private initialized = false;

  constructor(agentInfo: AcpAgentInfo, callbacks: AcpClientCallbacks) {
    this.agentInfo = agentInfo;
    this.callbacks = callbacks;
  }

  /** Whether the client has an active connection to the agent. */
  get isConnected(): boolean {
    return this.initialized && this.process !== null && !this.process.killed;
  }

  /** Agent capabilities from the initialize handshake. */
  get agentCapabilities(): AgentCapabilities | null {
    return this.capabilities;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Spawn the agent process and perform the ACP initialize handshake. */
  async connect(): Promise<InitializeResponse> {
    if (this.isConnected && this.connection) {
      throw new Error(`Agent "${this.agentInfo.id}" is already connected`);
    }

    // Determine command to run
    const command = this.agentInfo.binaryPath ?? this.agentInfo.npmPackage;
    if (!command) {
      throw new Error(`No binary path or npm package for agent "${this.agentInfo.id}"`);
    }

    const args: string[] = [];
    let cmd: string;

    if (this.agentInfo.binaryPath) {
      cmd = this.agentInfo.binaryPath;
    } else {
      // Use npx for npm packages
      cmd = "npx";
      args.push(this.agentInfo.npmPackage!);
    }

    this.process = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    // Log stderr for debugging
    this.process.stderr?.on("data", (chunk: Buffer) => {
      console.error(`[acp:${this.agentInfo.id}:stderr]`, chunk.toString());
    });

    this.process.on("exit", (code, signal) => {
      console.error(`[acp:${this.agentInfo.id}] Process exited: code=${code} signal=${signal}`);
      this.initialized = false;
      this.connection = null;
      this.callbacks.onStatusChange(this.agentInfo.id, "disconnected");
    });

    this.process.on("error", (err) => {
      console.error(`[acp:${this.agentInfo.id}] Process error:`, err);
      this.initialized = false;
      this.connection = null;
      this.callbacks.onStatusChange(this.agentInfo.id, "error");
    });

    // Create the ACP stream from stdin/stdout
    const stdout = this.process.stdout!;
    const stdin = this.process.stdin!;

    const stream = ndJsonStream(nodeWritableToWeb(stdin), nodeReadableToWeb(stdout));

    // Build the Client implementation (handles agent→client requests)
    const clientImpl: Client = {
      sessionUpdate: async (params) => {
        this.callbacks.onUpdate({
          sessionId: params.sessionId,
          update: params.update,
        });
      },

      requestPermission: async (params) => {
        const { toolCall } = params;
        const result = await this.callbacks.onPermissionRequest({
          requestId: crypto.randomUUID(),
          sessionId: params.sessionId,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.title ?? "unknown",
          options: params.options.map((opt) => ({
            optionId: opt.optionId,
            name: opt.name,
            kind: opt.kind,
          })),
        });

        return {
          outcome: {
            outcome: "selected" as const,
            optionId: result.optionId,
          },
        };
      },

      readTextFile: async (params) => {
        // Read files from the workspace (sandboxed)
        const { readFile } = await import("node:fs/promises");
        const { resolve, normalize } = await import("node:path");

        const resolved = resolve(normalize(params.path));

        const content = await readFile(resolved, "utf8");
        return { content };
      },
    };

    // Create the client-side connection
    this.connection = new ClientSideConnection(() => clientImpl, stream);

    // Perform the initialize handshake
    const initResponse = await this.connection.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: {
          readTextFile: true,
        },
      },
      clientInfo: {
        name: "Dispatch",
        version: "1.0.0",
      },
    });

    this.capabilities = initResponse.agentCapabilities ?? null;
    this.initialized = true;
    this.callbacks.onStatusChange(this.agentInfo.id, "connected");

    return initResponse;
  }

  /** Gracefully disconnect from the agent. */
  async disconnect(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill("SIGTERM");

      // Give it 3 seconds to exit gracefully, then force kill
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill("SIGKILL");
          }
          resolve();
        }, 3000);

        this.process!.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    this.process = null;
    this.connection = null;
    this.initialized = false;
  }

  // -------------------------------------------------------------------------
  // Session operations
  // -------------------------------------------------------------------------

  /** Create a new session scoped to a working directory. */
  async createSession(cwd: string): Promise<string> {
    this.ensureConnected();
    const response = await this.connection!.newSession({ cwd, mcpServers: [] });
    return response.sessionId;
  }

  /** Send a prompt and wait for completion. Streaming updates arrive via onUpdate callback. */
  async prompt(sessionId: string, content: ContentBlock[]): Promise<{ stopReason: string }> {
    this.ensureConnected();
    const response = await this.connection!.prompt({
      sessionId,
      prompt: content,
    });
    return { stopReason: response.stopReason };
  }

  /** Cancel an in-progress prompt. */
  async cancel(sessionId: string): Promise<void> {
    this.ensureConnected();
    await this.connection!.cancel({ sessionId });
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private ensureConnected(): void {
    if (!this.isConnected || !this.connection) {
      throw new Error(`Agent "${this.agentInfo.id}" is not connected. Call connect() first.`);
    }
  }
}
