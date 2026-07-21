import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathExists } from "./fs-utils.js";

// The agent layer compiles one canonical source (.agents/) into per-tool views.
// `saasaloy.agent.json` declares those views. Adding a new agent tool later is a
// single new entry here, then `saasaloy sync` — no code change (see build spec §2.13).

/** A file that receives the full concatenation of the source fragments. */
export interface ConcatTarget {
  path: string;
  /**
   * "agents": write the literal concatenation (Codex/Antigravity read it verbatim).
   * "import": write a one-line `@<importFrom>` reference (Claude Code resolves @-imports).
   */
  style: "agents" | "import";
  importFrom?: string;
}

/** A directory that receives a symlink to each source skill folder. */
export interface SkillsTarget {
  dir: string;
}

export interface AgentConfig {
  /** Canonical source directory holding NN-*.md fragments and skills/. */
  source: string;
  concat: ConcatTarget[];
  skills: SkillsTarget[];
}

export const AGENT_CONFIG_FILE = "saasaloy.agent.json";

/** Defaults used when no saasaloy.agent.json is present. */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  source: ".agents",
  concat: [
    { path: "AGENTS.md", style: "agents" },
    { path: "CLAUDE.md", style: "import", importFrom: "AGENTS.md" },
  ],
  skills: [{ dir: ".claude/skills" }],
};

/** Load saasaloy.agent.json from a project root, falling back to defaults. */
export async function loadAgentConfig(root: string): Promise<AgentConfig> {
  const file = join(root, AGENT_CONFIG_FILE);
  if (!(await pathExists(file))) {
    return DEFAULT_AGENT_CONFIG;
  }
  const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<AgentConfig>;
  return {
    source: parsed.source ?? DEFAULT_AGENT_CONFIG.source,
    concat: parsed.concat ?? DEFAULT_AGENT_CONFIG.concat,
    skills: parsed.skills ?? DEFAULT_AGENT_CONFIG.skills,
  };
}
