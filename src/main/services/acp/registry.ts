/**
 * Agent Registry — discovers installed ACP-compatible agents.
 *
 * Discovery is frictionless: if a user has `claude` or `codex` installed,
 * Dispatch automatically detects them and launches the ACP adapter via npx.
 * No separate adapter install required.
 */

import type { AcpAgentInfo, AgentBinarySpec, AgentConfig } from "./types";

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import * as repo from "../../db/repository";

const execFileAsync = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Known ACP agent adapters
// ---------------------------------------------------------------------------

const KNOWN_AGENTS: AgentBinarySpec[] = [
  {
    key: "claude",
    name: "Claude Code",
    binaries: ["claude-agent-acp"],
    baseCli: "claude",
    npmPackage: "@agentclientprotocol/claude-agent-acp",
  },
  {
    key: "codex",
    name: "Codex",
    binaries: ["codex-acp"],
    baseCli: "codex",
    // Codex ACP is a Rust binary — no npm package yet.
    // When the user has `codex` but not `codex-acp`, we show install guidance.
  },
  {
    key: "copilot",
    name: "GitHub Copilot",
    binaries: ["copilot-acp"],
    baseCli: "copilot",
  },
];

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Check if a binary exists in PATH using `which`. */
async function findBinary(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("which", [name], { timeout: 5000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AgentRegistry
// ---------------------------------------------------------------------------

const PREF_KEY_AGENTS = "acpAgents";

export class AgentRegistry {
  private agents = new Map<string, AcpAgentInfo>();

  /** Load saved agent configs from preferences. */
  loadSavedConfigs(): void {
    const raw = repo.getPreference(PREF_KEY_AGENTS);
    if (!raw) {
      return;
    }

    try {
      const configs = JSON.parse(raw) as AgentConfig[];
      for (const config of configs) {
        if (!config.enabled) {
          continue;
        }

        const known = KNOWN_AGENTS.find((a) => a.key === config.id);
        this.agents.set(config.id, {
          id: config.id,
          name: known?.name ?? config.id,
          binaryPath: config.binaryPath,
          npmPackage: known?.npmPackage,
          available: false, // Will be verified during discover()
          capabilities: null,
          agentInfo: null,
        });
      }
    } catch {
      // Invalid JSON — ignore
    }
  }

  /** Persist current agent configs to preferences. */
  private saveConfigs(): void {
    const configs: AgentConfig[] = [];
    for (const agent of this.agents.values()) {
      configs.push({
        id: agent.id,
        binaryPath: agent.binaryPath,
        enabled: true,
      });
    }
    repo.setPreference(PREF_KEY_AGENTS, JSON.stringify(configs));
  }

  /**
   * Scan the system for available ACP agents.
   *
   * Discovery strategy (per agent):
   * 1. Look for the ACP adapter binary in PATH (e.g. `claude-agent-acp`)
   * 2. If not found, look for the base CLI (e.g. `claude`)
   *    — if the base CLI exists AND we have an npm adapter package,
   *      mark available (npx will launch the adapter transparently)
   * 3. Check user-configured binary paths
   */
  async discover(): Promise<AcpAgentInfo[]> {
    const results: AcpAgentInfo[] = [];

    for (const spec of KNOWN_AGENTS) {
      const existing = this.agents.get(spec.key);

      // 1. Check for the ACP adapter binary directly
      let binaryPath = existing?.binaryPath ?? null;
      if (!binaryPath) {
        for (const bin of spec.binaries) {
          binaryPath = await findBinary(bin);
          if (binaryPath) {
            break;
          }
        }
      }

      let available = binaryPath !== null;
      let baseCliFound = false;

      // 2. If no adapter binary, check for the base CLI
      if (!available && spec.baseCli) {
        const baseCliPath = await findBinary(spec.baseCli);
        baseCliFound = baseCliPath !== null;

        // If the base CLI exists and we have an npm package, we can npx the adapter
        if (baseCliFound && spec.npmPackage) {
          available = true;
        }
      }

      const info: AcpAgentInfo = {
        id: spec.key,
        name: spec.name,
        binaryPath,
        npmPackage: spec.npmPackage,
        available,
        capabilities: existing?.capabilities ?? null,
        agentInfo: existing?.agentInfo ?? null,
      };

      this.agents.set(spec.key, info);
      results.push(info);
    }

    // Also include any user-configured agents not in KNOWN_AGENTS
    for (const [id, agent] of this.agents) {
      if (!KNOWN_AGENTS.some((k) => k.key === id)) {
        results.push(agent);
      }
    }

    this.saveConfigs();
    return results;
  }

  /** Get all registered agents (without re-scanning). */
  listAgents(): AcpAgentInfo[] {
    return [...this.agents.values()];
  }

  /** Get a specific agent by ID. */
  getAgent(id: string): AcpAgentInfo | null {
    return this.agents.get(id) ?? null;
  }

  /** Get the first available agent, preferring user's default. */
  getDefaultAgent(): AcpAgentInfo | null {
    const defaultId = repo.getPreference("acpDefaultAgent");
    if (defaultId) {
      const agent = this.agents.get(defaultId);
      if (agent?.available) {
        return agent;
      }
    }

    // Fall back to first available
    for (const agent of this.agents.values()) {
      if (agent.available) {
        return agent;
      }
    }

    return null;
  }

  /** Set the default agent. */
  setDefaultAgent(agentId: string): void {
    repo.setPreference("acpDefaultAgent", agentId);
  }

  /** Manually add or update an agent. */
  setAgent(info: AcpAgentInfo): void {
    this.agents.set(info.id, info);
    this.saveConfigs();
  }

  /** Remove a user-configured agent. */
  removeAgent(id: string): void {
    this.agents.delete(id);
    this.saveConfigs();
  }

  /** Update capabilities after a successful initialize handshake. */
  updateCapabilities(agentId: string, capabilities: AcpAgentInfo["capabilities"]): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.capabilities = capabilities;
    }
  }
}
