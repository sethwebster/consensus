#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fstatSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as p from "@clack/prompts";
import pc from "picocolors";
import type { Config, Member } from "./config.js";
import {
  CONFIG_PATH,
  DEFAULT_TIMEOUT_MS,
  defaultConfig,
  loadConfig,
  memberLabel,
  parseMember,
  pickSynthesizer,
  saveConfig,
} from "./config.js";
import { PROVIDERS, detect, getProvider } from "./providers.js";
import { transcript } from "./report.js";
import type { StoredSession } from "./sessions.js";
import {
  latestSession,
  listSessions,
  loadSession,
  relativeTime,
  removeSession,
  sessionTitle,
} from "./sessions.js";
import type { RunResult } from "./run.js";
import { runAll, runMember } from "./run.js";
import { attributeSources, buildSynthesisPrompt, summarize } from "./synthesize.js";
import { Board, rule } from "./ui.js";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json") as { version: string };

const HELP = `${pc.bold("consensus")} — ask one prompt to many AI CLIs, then merge the answers into one.

${pc.bold("USAGE")}
  consensus [options] <prompt...>
  consensus <command> [options]

${pc.bold("COMMANDS")}
  ask <prompt>     Ask the panel (default; the word "ask" is optional)
  tui [prompt]     Full-screen interactive REPL (also: --tui)
  resume [id]      Reopen a saved session — the most recent when id is omitted
  sessions         List saved sessions ("sessions rm <id>" deletes one)
  init [-y]        Choose the panel and synthesizer; -y accepts autodetection
  skill install    Install the bundled Agent Skill ("skill install --help" for targets)
  detect           Show which model CLIs are installed
  config           Print the active configuration and its path

${pc.bold("OPTIONS")}
  -m, --model <spec>   Panel member for this run; repeatable. Overrides config.
                       Format: provider or provider:model (e.g. ollama:qwen3:8b)
  -s, --synth <spec>   Synthesizer for this run
  -f, --file <path>    Read the prompt from a file
      --stdin          Include piped stdin alongside an inline prompt (same as -)
  -a, --all            Also print each member's raw response
      --no-synth       Skip synthesis; print the raw responses only
      --json           Emit machine-readable JSON on stdout
  -o, --out <path>     Write a full markdown transcript to a file
  -t, --timeout <sec>  Per-member time limit (default ${DEFAULT_TIMEOUT_MS / 1000}s)
      --cwd <path>     Working directory the member CLIs run in (default: here)
  -h, --help           Show this help
  -v, --version        Show version

${pc.bold("EXAMPLES")}
  consensus "what are the tradeoffs of event sourcing?"
  consensus -m claude -m codex -m gemini "review src/auth.ts for race conditions"
  cat spec.md | consensus                       # piped input is the whole prompt
  cat spec.md | consensus - "critique this"     # piped input plus an instruction
  consensus -s codex -o answer.md "design a rate limiter"
`;

async function main(argv: string[]): Promise<number> {
  // Handled before parseArgs: the installer has its own flags (--project,
  // --dir, …) that the main option table would reject.
  if (argv[0] === "skill") return skillCommand(argv.slice(1));

  const commands = new Set([
    "ask",
    "tui",
    "resume",
    "sessions",
    "init",
    "detect",
    "config",
    "help",
  ]);
  const command = commands.has(argv[0] ?? "") ? argv.shift()! : "ask";

  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      model: { type: "string", short: "m", multiple: true },
      synth: { type: "string", short: "s" },
      file: { type: "string", short: "f" },
      stdin: { type: "boolean", default: false },
      all: { type: "boolean", short: "a", default: false },
      "no-synth": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      out: { type: "string", short: "o" },
      timeout: { type: "string", short: "t" },
      cwd: { type: "string" },
      yes: { type: "boolean", short: "y", default: false },
      tui: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  if (values.help || command === "help") {
    console.log(HELP);
    return 0;
  }

  switch (command) {
    case "tui":
      return tui(values, positionals);
    case "resume":
      return tui(values, positionals, positionals[0] ?? "");
    case "sessions":
      return sessionsCommand(positionals);
    case "init":
      return init(Boolean(values.yes));
    case "detect":
      return showDetected();
    case "config":
      return showConfig();
    default:
      return ask(values, positionals);
  }
}

type Values = Awaited<ReturnType<typeof parseArgs>>["values"] & Record<string, unknown>;

/** `consensus skill install [...]` — run the bundled installer, forwarding its flags. */
function skillCommand(rest: string[]): number {
  const [sub, ...flags] = rest;
  if (sub !== "install") {
    console.error(pc.red(`Usage: consensus skill install [--global | --project | --dir <path>] [--force]`));
    console.error(pc.dim("Run `consensus skill install --help` for details."));
    return 2;
  }
  const installer = fileURLToPath(new URL("../scripts/install-skill.mjs", import.meta.url));
  const { status, error } = spawnSync(process.execPath, [installer, ...flags], { stdio: "inherit" });
  if (error) throw error;
  return status ?? 1;
}

/**
 * Launch the REPL. ink is imported lazily to keep plain `ask` runs fast.
 * `resumeId` is "" to mean "the most recent session".
 */
async function tui(values: Values, positionals: string[], resumeId?: string): Promise<number> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error(pc.red("The REPL needs an interactive terminal."));
    console.error(pc.dim("Use `consensus <prompt>` for piped or scripted runs."));
    return 2;
  }

  let restore: StoredSession | undefined;
  if (resumeId !== undefined) {
    const found = resumeId ? loadSession(resumeId) : latestSession();
    if (!found) {
      console.error(
        pc.red(resumeId ? `No session matching "${resumeId}".` : "No saved sessions yet."),
      );
      console.error(pc.dim("Run `consensus sessions` to list them."));
      return 1;
    }
    restore = found;
  }

  const config = await resolveConfig(values);
  if (config.members.length === 0) {
    console.error(pc.red("No panel members configured and no supported CLIs found on PATH."));
    return 1;
  }

  // When resuming, the prompt words were the session id.
  const prompt = resumeId !== undefined
    ? ""
    : positionals.filter((word) => word !== "-").join(" ").trim();

  const { startTui } = await import("./tui/index.js");
  return startTui(
    config,
    (values.cwd as string | undefined) ?? process.cwd(),
    prompt || undefined,
    restore,
  );
}

function sessionsCommand(positionals: string[]): number {
  if (positionals[0] === "rm" || positionals[0] === "remove") {
    const id = positionals[1];
    if (!id) {
      console.error(pc.red("Usage: consensus sessions rm <id>"));
      return 2;
    }
    const removed = removeSession(id);
    if (!removed) {
      console.error(pc.red(`No session matching "${id}".`));
      return 1;
    }
    console.log(`Removed ${removed}`);
    return 0;
  }

  const sessions = listSessions();
  if (sessions.length === 0) {
    console.log(pc.dim("No sessions yet. Start one with `consensus tui`."));
    return 0;
  }

  const width = Math.min(process.stdout.columns || 80, 100);
  for (const session of sessions) {
    const id = pc.cyan(session.id.slice(-4));
    const when = relativeTime(session.updatedAt).padEnd(9);
    const turns = `${session.turns.length}t`.padEnd(5);
    const title = sessionTitle(session);
    const room = Math.max(10, width - 30);
    console.log(
      `  ${id}  ${pc.dim(when)}${pc.dim(turns)}${title.length > room ? `${title.slice(0, room - 1)}…` : title}`,
    );
  }
  console.log(pc.dim(`\n${sessions.length} session${sessions.length === 1 ? "" : "s"} · resume with \`consensus resume <id>\``));
  return 0;
}

async function ask(values: Values, positionals: string[]): Promise<number> {
  if (values.tui) return tui(values, positionals);

  const prompt = await readPrompt(
    values.file as string | undefined,
    positionals,
    Boolean(values.stdin),
  );
  if (!prompt) {
    console.error(pc.red("No prompt given.") + " Pass one as an argument, with --file, or on stdin.");
    console.error(pc.dim("Run `consensus --help` for usage."));
    return 2;
  }

  const config = await resolveConfig(values);
  if (config.members.length === 0) {
    console.error(pc.red("No panel members configured and no supported CLIs found on PATH."));
    console.error(pc.dim("Run `consensus detect` to see what consensus looks for."));
    return 1;
  }

  const cwd = (values.cwd as string | undefined) ?? process.cwd();
  const labels = config.members.map(memberLabel);
  const board = new Board(labels);

  process.stderr.write(`${pc.dim(`asking ${labels.length} model${labels.length === 1 ? "" : "s"}…`)}\n`);
  board.start();

  const answers = await runAll(config.members, prompt, {
    cwd,
    timeoutMs: config.timeoutMs,
    onUpdate: (label, state) => board.update(label, state),
  });

  board.stop();

  const succeeded = answers.filter((a) => a.ok);
  if (succeeded.length === 0) {
    console.error(`\n${pc.red("Every panel member failed.")}`);
    for (const answer of answers) console.error(`  ${pc.red("✖")} ${answer.label}: ${answer.error}`);
    return 1;
  }

  let synthesis: RunResult | null = null;
  const wantSynthesis = !values["no-synth"] && succeeded.length > 1;

  if (wantSynthesis) {
    const synthLabel = `synthesizing (${memberLabel(config.synthesizer)})`;
    const synthBoard = new Board([synthLabel]);
    synthBoard.start();

    synthesis = await runMember(
      config.synthesizer,
      buildSynthesisPrompt({ prompt, answers: succeeded }),
      {
        cwd,
        timeoutMs: config.timeoutMs,
        onUpdate: (_, state) => synthBoard.update(synthLabel, state),
      },
    );
    synthBoard.stop();
    if (synthesis.ok) synthesis = { ...synthesis, text: attributeSources(synthesis.text, succeeded) };
  } else if (!values["no-synth"] && succeeded.length === 1) {
    process.stderr.write(pc.dim("only one member responded — nothing to synthesize\n"));
  }

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          prompt,
          members: answers.map((a) => ({
            member: a.member,
            label: a.label,
            ok: a.ok,
            ms: a.ms,
            response: a.text,
            error: a.error ?? null,
          })),
          synthesis: synthesis
            ? { by: memberLabel(config.synthesizer), ok: synthesis.ok, text: synthesis.text, error: synthesis.error ?? null }
            : null,
        },
        null,
        2,
      ),
    );
  } else {
    printReport(answers, synthesis, Boolean(values.all), config);
  }

  if (values.out) {
    writeFileSync(
      values.out as string,
      transcript({
        prompt,
        answers,
        synthesis,
        synthesizedBy: memberLabel(config.synthesizer),
      }),
      "utf8",
    );
    process.stderr.write(pc.dim(`transcript → ${values.out}\n`));
  }

  if (synthesis && !synthesis.ok) return 1;
  return 0;
}

function printReport(
  answers: RunResult[],
  synthesis: RunResult | null,
  showAll: boolean,
  config: Config,
): void {
  process.stderr.write(`\n${pc.dim(summarize(answers))}\n`);

  let headed = false;
  if (showAll || !synthesis) {
    for (const answer of answers.filter((a) => a.ok)) {
      console.log(`\n${rule(answer.label)}\n`);
      console.log(answer.text);
    }
    if (synthesis) {
      console.log(`\n${rule("consensus")}\n`);
      headed = true;
    }
  }

  if (!synthesis) return;

  if (!synthesis.ok) {
    console.error(
      `\n${pc.red(`Synthesis via ${memberLabel(config.synthesizer)} failed:`)} ${synthesis.error}`,
    );
    if (!showAll) {
      console.error(pc.dim("The raw responses are printed below so the work is not lost.\n"));
      for (const answer of answers.filter((a) => a.ok)) {
        console.log(`\n${rule(answer.label)}\n`);
        console.log(answer.text);
      }
    }
    return;
  }

  // The rule already supplied the leading blank line when --all printed it.
  console.log(headed ? `${synthesis.text}\n` : `\n${synthesis.text}\n`);
}


/** Merge config file, CLI overrides, and autodetection into one runnable plan. */
async function resolveConfig(values: Values): Promise<Config> {
  const stored = loadConfig();
  const overrides = (values.model as string[] | undefined)?.map(parseMember);

  let base: Config;
  if (stored) {
    base = stored;
  } else {
    base = defaultConfig(await detect());
    if (!overrides) {
      process.stderr.write(
        pc.dim(`no config yet — using every detected CLI. Run \`consensus init\` to choose.\n`),
      );
    }
  }

  const members = overrides ?? base.members;
  const synthesizer = values.synth
    ? parseMember(values.synth as string)
    : overrides
      ? pickSynthesizer(members)
      : base.synthesizer;

  const timeoutMs = values.timeout
    ? Math.round(Number(values.timeout) * 1000)
    : base.timeoutMs;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid --timeout "${values.timeout}"; expected seconds.`);
  }

  return { members, synthesizer, timeoutMs };
}

/**
 * Assemble the prompt from --file, stdin, and inline words, in that order.
 *
 * stdin is only consumed when it is the sole source or the caller asked for it
 * with `-` / --stdin. Reading it unconditionally wedges the CLI whenever it
 * inherits an open-but-idle stdin, as it does under CI runners and cron.
 */
async function readPrompt(
  file: string | undefined,
  positionals: string[],
  explicitStdin: boolean,
): Promise<string> {
  const marked = positionals.includes("-");
  const inline = positionals.filter((word) => word !== "-").join(" ").trim();
  const parts: string[] = [];

  if (file) parts.push(readFileSync(file, "utf8").trim());

  const piped = hasPipedStdin();
  const hasOtherSource = Boolean(inline || file);

  if (piped && (explicitStdin || marked || !hasOtherSource)) {
    const text = (await readStdin()).trim();
    if (text) parts.push(text);
  } else if (piped && hasOtherSource) {
    process.stderr.write(pc.dim("stdin not read — pass `-` or --stdin to include it\n"));
  }

  if (inline) parts.push(inline);
  return parts.filter(Boolean).join("\n\n").trim();
}

/**
 * True only when stdin can actually carry a prompt. A TTY has a human on it and
 * `/dev/null` is a character device that will never produce bytes; neither is
 * worth reading from or warning about.
 */
function hasPipedStdin(): boolean {
  if (process.stdin.isTTY) return false;
  try {
    const stat = fstatSync(0);
    return stat.isFIFO() || stat.isFile() || stat.isSocket();
  } catch {
    return false;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function showDetected(): Promise<number> {
  const spinner = p.spinner();
  spinner.start("Scanning PATH for model CLIs");
  const detected = await detect();
  spinner.stop(`Found ${detected.length} of ${PROVIDERS.length} supported CLIs`);

  for (const provider of PROVIDERS) {
    const hit = detected.find((d) => d.provider.id === provider.id);
    if (!hit) {
      console.log(`  ${pc.dim("✖")} ${pc.dim(provider.id.padEnd(14))} ${pc.dim("not installed")}`);
      continue;
    }
    const models = hit.models.length
      ? pc.dim(` ${hit.models.length} model${hit.models.length === 1 ? "" : "s"}`)
      : "";
    console.log(`  ${pc.green("✔")} ${provider.id.padEnd(14)} ${pc.dim(hit.path)}${models}`);
  }

  const config = loadConfig();
  console.log(
    `\n${pc.dim(config ? `Panel: ${config.members.map(memberLabel).join(", ")}` : "No config yet — run `consensus init`.")}`,
  );
  return 0;
}

function showConfig(): number {
  const config = loadConfig();
  if (!config) {
    console.log(pc.dim(`No config at ${CONFIG_PATH}. Run \`consensus init\`.`));
    return 0;
  }
  console.log(pc.dim(CONFIG_PATH));
  console.log(JSON.stringify(config, null, 2));
  return 0;
}

async function init(auto: boolean): Promise<number> {
  if (auto) {
    const detected = await detect();
    if (detected.length === 0) {
      console.error(pc.red("No supported model CLIs found on PATH."));
      return 1;
    }
    const config = defaultConfig(detected);
    saveConfig(config);
    console.log(`Panel: ${config.members.map(memberLabel).join(", ")}`);
    console.log(`Synthesizer: ${memberLabel(config.synthesizer)}`);
    console.log(pc.dim(`Saved to ${CONFIG_PATH}`));
    return 0;
  }

  p.intro(pc.bgCyan(pc.black(" consensus ")));

  const spinner = p.spinner();
  spinner.start("Detecting installed model CLIs");
  const detected = await detect();
  spinner.stop(`Detected ${detected.length} CLI${detected.length === 1 ? "" : "s"}`);

  if (detected.length === 0) {
    p.cancel("No supported model CLIs found on PATH. Install one (claude, codex, gemini, ollama, …) and retry.");
    return 1;
  }

  const existing = loadConfig();
  const preselected = new Set((existing?.members ?? defaultConfig(detected).members).map((m) => m.provider));

  const chosen = await p.multiselect({
    message: "Which CLIs should answer every prompt?",
    options: detected.map((d) => ({
      value: d.provider.id,
      label: d.provider.label,
      hint: d.models.length ? `${d.models.length} local models` : d.provider.bin,
    })),
    initialValues: detected.filter((d) => preselected.has(d.provider.id)).map((d) => d.provider.id),
    required: true,
  });
  if (p.isCancel(chosen)) return cancel();

  const members: Member[] = [];
  for (const id of chosen) {
    const hit = detected.find((d) => d.provider.id === id)!;

    if (!hit.provider.needsModel) {
      members.push({ provider: id });
      continue;
    }
    if (hit.models.length === 0) {
      p.log.warn(`${hit.provider.label} has no models installed — skipping.`);
      continue;
    }
    const previous = (existing?.members ?? []).filter((m) => m.provider === id).map((m) => m.model!);
    const picks = await p.multiselect({
      message: `Which ${hit.provider.label} models?`,
      options: hit.models.map((m) => ({ value: m, label: m })),
      initialValues: previous.length ? previous : [hit.models[0]!],
      required: true,
    });
    if (p.isCancel(picks)) return cancel();
    for (const model of picks) members.push({ provider: id, model });
  }

  if (members.length === 0) {
    p.cancel("No usable panel members selected.");
    return 1;
  }

  const suggested = existing && members.some((m) => memberLabel(m) === memberLabel(existing.synthesizer))
    ? existing.synthesizer
    : pickSynthesizer(members);

  const synthSpec = await p.select({
    message: "Which model should synthesize the final answer?",
    options: members.map((m) => ({
      value: memberLabel(m),
      label: memberLabel(m),
      hint: getProvider(m.provider)?.label,
    })),
    initialValue: memberLabel(suggested),
  });
  if (p.isCancel(synthSpec)) return cancel();

  const timeout = await p.text({
    message: "Per-model timeout in seconds",
    initialValue: String(Math.round((existing?.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)),
    validate: (value) => (Number(value) > 0 ? undefined : "Enter a positive number of seconds."),
  });
  if (p.isCancel(timeout)) return cancel();

  const config: Config = {
    members,
    synthesizer: parseMember(synthSpec),
    timeoutMs: Math.round(Number(timeout) * 1000),
  };
  saveConfig(config);

  p.note(
    `${members.map(memberLabel).join("\n")}\n${pc.dim(`synthesized by ${synthSpec}`)}`,
    "Panel",
  );
  p.outro(`Saved to ${pc.dim(CONFIG_PATH)} — try ${pc.cyan('consensus "hello"')}`);
  return 0;
}

function cancel(): number {
  p.cancel("Cancelled.");
  return 1;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: Error) => {
    console.error(`${pc.red("error:")} ${err.message}`);
    process.exitCode = 1;
  });
