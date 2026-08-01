import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface Provider {
  /** Stable key used in config files. */
  id: string;
  /** Display name. */
  label: string;
  /** Executable looked up on PATH. */
  bin: string;
  /** Argv for a single-shot, non-interactive prompt. */
  argv(prompt: string, model?: string): string[];
  /** A model name must be chosen before this provider can run. */
  needsModel?: boolean;
  /** Enumerate selectable models, when the provider can report them. */
  listModels?(): Promise<string[]>;
  /** Trim provider-specific chrome from captured stdout. */
  postprocess?(out: string): string;
  /** Extra environment applied on top of the inherited env. */
  env?: Record<string, string>;
}

/**
 * Ordered by how well each CLI works as a synthesizer: long-context,
 * instruction-following agents first, local models last.
 */
export const PROVIDERS: Provider[] = [
  {
    id: "claude",
    label: "Claude Code",
    bin: "claude",
    argv: (prompt, model) => [
      ...(model ? ["--model", model] : []),
      "--print",
      prompt,
    ],
  },
  {
    id: "codex",
    label: "Codex",
    bin: "codex",
    argv: (prompt, model) => [
      "exec",
      ...(model ? ["--model", model] : []),
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--color",
      "never",
      prompt,
    ],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    bin: "gemini",
    argv: (prompt, model) => [
      ...(model ? ["--model", model] : []),
      // Headless runs are refused in untrusted directories without this.
      "--skip-trust",
      "--output-format",
      "text",
      "--prompt",
      prompt,
    ],
  },
  {
    id: "cursor-agent",
    label: "Cursor Agent",
    bin: "cursor-agent",
    argv: (prompt, model) => [
      ...(model ? ["--model", model] : []),
      "--output-format",
      "text",
      "--print",
      prompt,
    ],
  },
  {
    id: "opencode",
    label: "opencode",
    bin: "opencode",
    argv: (prompt, model) => [
      "run",
      ...(model ? ["--model", model] : []),
      prompt,
    ],
  },
  {
    id: "amp",
    label: "Amp",
    bin: "amp",
    argv: (prompt) => ["-x", prompt],
  },
  {
    id: "droid",
    label: "Factory Droid",
    bin: "droid",
    argv: (prompt, model) => [
      "exec",
      ...(model ? ["--model", model] : []),
      prompt,
    ],
  },
  {
    id: "crush",
    label: "Crush",
    bin: "crush",
    argv: (prompt, model) => [
      "run",
      ...(model ? ["--model", model] : []),
      "--quiet",
      prompt,
    ],
  },
  {
    id: "goose",
    label: "Goose",
    bin: "goose",
    argv: (prompt) => ["run", "--quiet", "--text", prompt],
  },
  {
    id: "q",
    label: "Amazon Q",
    bin: "q",
    argv: (prompt) => ["chat", "--no-interactive", prompt],
  },
  {
    id: "llm",
    label: "llm (simonw)",
    bin: "llm",
    argv: (prompt, model) => [...(model ? ["-m", model] : []), prompt],
    listModels: async () => {
      const { stdout } = await execFileAsync("llm", ["models", "list"], {
        maxBuffer: 1 << 22,
      });
      return stdout
        .split("\n")
        .map((line) => line.match(/:\s*(\S+)/)?.[1])
        .filter((m): m is string => Boolean(m));
    },
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    bin: "ollama",
    needsModel: true,
    argv: (prompt, model) => ["run", model!, prompt],
    listModels: async () => {
      const { stdout } = await execFileAsync("ollama", ["list"], {
        maxBuffer: 1 << 22,
      });
      return stdout
        .split("\n")
        .slice(1)
        .map((line) => line.trim().split(/\s+/)[0])
        .filter((m): m is string => Boolean(m));
    },
  },
];

export function getProvider(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Resolve an executable against PATH without shelling out. */
export function which(bin: string): string | null {
  if (bin.includes("/")) {
    return isExecutable(bin) ? (isAbsolute(bin) ? bin : join(process.cwd(), bin)) : null;
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, bin);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface Detected {
  provider: Provider;
  path: string;
  models: string[];
}

/** Find every supported CLI installed on this machine. */
export async function detect(): Promise<Detected[]> {
  const found = PROVIDERS.map((provider) => ({ provider, path: which(provider.bin) })).filter(
    (entry): entry is { provider: Provider; path: string } => entry.path !== null,
  );

  return Promise.all(
    found.map(async ({ provider, path }) => ({
      provider,
      path,
      models: provider.listModels ? await provider.listModels().catch(() => []) : [],
    })),
  );
}
