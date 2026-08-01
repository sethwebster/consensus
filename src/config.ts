import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Detected } from "./providers.js";
import { getProvider } from "./providers.js";

export interface Member {
  provider: string;
  model?: string;
}

export interface Config {
  /** Panel members asked in parallel. */
  members: Member[];
  /** Model that merges the panel's answers into one. */
  synthesizer: Member;
  /** Per-member wall-clock limit in milliseconds. */
  timeoutMs: number;
}

export const CONFIG_DIR =
  process.env.CONSENSUS_HOME ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "consensus");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Preference order for the synthesizer. Long-context agents that follow
 * structured instructions closely make the best merge step.
 */
const SYNTH_PREFERENCE = ["claude", "codex", "gemini", "cursor-agent", "opencode", "amp", "droid"];

export function loadConfig(): Config | null {
  try {
    return normalize(JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Could not read ${CONFIG_PATH}: ${(err as Error).message}`);
  }
}

export function saveConfig(config: Config): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function normalize(config: Config): Config {
  return {
    members: config.members ?? [],
    synthesizer: config.synthesizer ?? { provider: "claude" },
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

/**
 * Build a usable config from whatever is installed: every detected CLI that
 * runs without extra setup joins the panel, and the highest-preference one
 * synthesizes.
 */
export function defaultConfig(detected: Detected[]): Config {
  const members: Member[] = detected
    .filter((d) => !d.provider.needsModel || d.models.length > 0)
    .map((d) => ({
      provider: d.provider.id,
      ...(d.provider.needsModel ? { model: d.models[0]! } : {}),
    }));

  return {
    members,
    synthesizer: pickSynthesizer(members),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

export function pickSynthesizer(members: Member[]): Member {
  for (const id of SYNTH_PREFERENCE) {
    const match = members.find((m) => m.provider === id);
    if (match) return { ...match };
  }
  return members[0] ?? { provider: "claude" };
}

export function memberLabel(member: Member): string {
  return member.model ? `${member.provider}:${member.model}` : member.provider;
}

/** Parse `provider` or `provider:model` (models may themselves contain colons). */
export function parseMember(spec: string): Member {
  const at = spec.indexOf(":");
  const provider = at === -1 ? spec : spec.slice(0, at);
  const model = at === -1 ? undefined : spec.slice(at + 1);

  if (!getProvider(provider)) {
    throw new Error(`Unknown provider "${provider}". Run \`consensus detect\` to see what is available.`);
  }
  return model ? { provider, model } : { provider };
}
