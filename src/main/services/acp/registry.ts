/**
 * Agent Registry — discovers installed ACP-compatible agent binaries.
 *
 * Scans the system PATH for known agent binaries and checks user-configured
 * paths. Persists agent configuration to preferences.
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
    npmPackage: "@agentclientprotocol/claude-agent-acp",
  },
  {
    key: "codex",
    name: "Codex",
    binaries: ["codex-acp"],
  },
  {
    key: "copilot",
    name: "GitHub Copilot",
    binaries: ["copilot-acp"],
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

/** Check if an npm package is globally installed and resolvable via npx. */
async function isNpmPackageAvailable(packageName: string): Promise<boolean> {
  try {
    await execFileAsync("npx", ["--yes", "--package", packageName, "echo", "ok"], {
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
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
          available: false, // Will be checked during discover()
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
   * Scan the system for available ACP agent binaries.
   * Merges with any user-configured agents.
   */
  async discover(): Promise<AcpAgentInfo[]> {
    const results: AcpAgentInfo[] = [];

    for (const spec of KNOWN_AGENTS) {
      // Check if user already has a manual config for this agent
      const existing = this.agents.get(spec.key);

      // Try to find the binary in PATH
      let binaryPath = existing?.binaryPath ?? null;
      if (!binaryPath) {
        for (const bin of spec.binaries) {
          binaryPath = await findBinary(bin);
          if (binaryPath) {
            break;
          }
        }
      }

      // If no binary found, check npm package availability
      let available = binaryPath !== null;
      if (!available && spec.npmPackage) {
        available = await isNpmPackageAvailable(spec.npmPackage);
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
