import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "./config.js";
import type { Member } from "./config.js";
import { memberLabel } from "./config.js";
import { getProvider, which } from "./providers.js";

export interface RunResult {
  member: Member;
  label: string;
  ok: boolean;
  text: string;
  error?: string;
  ms: number;
}

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
  /** Called on every state change so callers can render progress. */
  onUpdate?(label: string, state: RunState): void;
  /** Kills the child process when aborted. */
  signal?: AbortSignal;
}

export interface RunState {
  status: "running" | "done" | "failed";
  bytes: number;
  ms: number;
  error?: string;
}

/** CSI escape sequences (colors, cursor moves) and OSC hyperlink/title sequences. */
const CSI = /\u001B\[[0-?]*[ -/]*[@-~]/g;
const OSC = /\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g;

function clean(text: string): string {
  return text.replace(OSC, "").replace(CSI, "").replace(/\r/g, "").trim();
}

/** Children currently running, so a signal can take them all down. */
const active = new Set<ChildProcess>();

/**
 * Kill a member and everything it started.
 *
 * Agent CLIs spawn helpers of their own — codex brings up MCP servers — and
 * signalling only the process we launched leaves those running. Members are
 * spawned into their own process group so the whole tree can be taken down
 * with one negative-pid signal.
 */
function killTree(child: ChildProcess, signal: NodeJS.Signals = "SIGKILL"): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already gone.
    }
  }
}

let handlersInstalled = false;

/**
 * A detached child no longer shares our process group, so it does not receive
 * the terminal's ctrl-c. Forward termination signals ourselves instead of
 * leaving models running after the CLI is interrupted. (The REPL keeps stdin in
 * raw mode, where ctrl-c never becomes SIGINT, so this only affects plain runs.)
 */
function installSignalHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      for (const child of active) killTree(child);
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }
}

/** Run one member's CLI to completion and capture its answer. */
export async function runMember(
  member: Member,
  prompt: string,
  options: RunOptions,
): Promise<RunResult> {
  const label = memberLabel(member);
  const started = Date.now();
  const provider = getProvider(member.provider);

  if (!provider) {
    return fail(member, label, `Unknown provider "${member.provider}"`, started);
  }
  if (provider.needsModel && !member.model) {
    return fail(member, label, `${provider.label} requires a model (use ${provider.id}:<model>)`, started);
  }
  const bin = which(provider.bin);
  if (!bin) {
    return fail(member, label, `\`${provider.bin}\` is not on PATH`, started);
  }
  if (options.signal?.aborted) {
    return fail(member, label, "cancelled", started);
  }

  options.onUpdate?.(label, { status: "running", bytes: 0, ms: 0 });

  installSignalHandlers();

  return new Promise<RunResult>((resolve) => {
    const argv = provider.argv(prompt, member.model);
    const child = spawn(provider.bin, argv, {
      cwd: options.cwd,
      env: { ...process.env, ...provider.env, NO_COLOR: "1", FORCE_COLOR: "0", TERM: "dumb" },
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group, so killTree can reach the member's own children.
      detached: true,
    });
    active.add(child);

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      abandon(`timed out after ${Math.round(options.timeoutMs / 1000)}s`);
    }, options.timeoutMs);
    let timedOut = false;
    let cancelled = false;

    /**
     * Settle without waiting for `close`.
     *
     * `close` fires only once every stdio stream has closed, and a helper the
     * member spawned inherits our pipes — so a killed member whose child still
     * holds stdout would otherwise leave the run hanging forever. Once we have
     * decided to stop, the output so far is all we are going to use.
     */
    const abandon = (error: string) => {
      killTree(child);
      child.stdout?.destroy();
      child.stderr?.destroy();
      const text = provider.postprocess ? provider.postprocess(clean(stdout)) : clean(stdout);
      finish({ member, label, ok: false, text, error, ms: Date.now() - started });
    };

    const onAbort = () => {
      cancelled = true;
      abandon("cancelled");
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const progress = setInterval(() => {
      if (!settled) {
        options.onUpdate?.(label, {
          status: "running",
          bytes: stdout.length,
          ms: Date.now() - started,
        });
      }
    }, 120);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(lingering);
      clearInterval(progress);
      active.delete(child);
      options.signal?.removeEventListener("abort", onAbort);
      options.onUpdate?.(label, {
        status: result.ok ? "done" : "failed",
        bytes: result.text.length,
        ms: result.ms,
        error: result.error,
      });
      resolve(result);
    };

    child.on("error", (err) => {
      finish(fail(member, label, err.message, started));
    });

    // The member itself has exited; if `close` does not follow, something it
    // spawned is still holding our pipes. Take what we have rather than wait.
    let lingering: NodeJS.Timeout | undefined;
    child.on("exit", () => {
      lingering = setTimeout(() => {
        if (settled) return;
        const text = provider.postprocess ? provider.postprocess(clean(stdout)) : clean(stdout);
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish(
          text
            ? { member, label, ok: true, text, ms: Date.now() - started }
            : { member, label, ok: false, text, error: "exited without output", ms: Date.now() - started },
        );
      }, 2000);
      lingering.unref?.();
    });

    child.on("close", (code, signal) => {
      const ms = Date.now() - started;
      const text = provider.postprocess ? provider.postprocess(clean(stdout)) : clean(stdout);

      if (cancelled) {
        finish({ member, label, ok: false, text, error: "cancelled", ms });
        return;
      }
      const error = timedOut
        ? `timed out after ${Math.round(options.timeoutMs / 1000)}s`
        : code !== 0
          ? explain(stderr, code)
          : !text
            ? "returned an empty response"
            : null;
      if (error) {
        logFailure({ label, bin, argv, cwd: options.cwd, code, signal, error, stderr });
        finish({ member, label, ok: false, text, error, ms });
        return;
      }
      finish({ member, label, ok: true, text, ms });
    });
  });
}

/**
 * Pull the human-meaningful line out of a failed CLI's stderr. Stack frames and
 * progress noise crowd out the real message, so prefer a line that reads like an
 * error and fall back to the last thing printed.
 */
function explain(stderr: string, code: number | null): string {
  const lines = clean(stderr)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^\s*at\s/.test(line));

  const headline =
    lines.find((line) => /\b(error|failed|unauthori|denied|invalid|required|not found|missing|quota|rate limit)\b/i.test(line)) ??
    lines.at(-1);

  return headline ? headline.slice(0, 300) : `exited with code ${code}`;
}

function fail(member: Member, label: string, error: string, started: number): RunResult {
  return { member, label, ok: false, text: "", error, ms: Date.now() - started };
}

/**
 * The whole story behind a failed member, appended to CONFIG_DIR/debug.log.
 *
 * The UI shows one stderr headline, which is enough for "not logged in" but
 * not for environment-specific failures — a terminal whose PATH resolves a
 * different binary, an env var the CLI objects to. Recording the resolved
 * binary, PATH, exit status and full stderr makes those diagnosable from any
 * terminal after the fact.
 */
function logFailure(details: {
  label: string;
  bin: string;
  argv: string[];
  cwd: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  error: string;
  stderr: string;
}): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    const entry = [
      `--- ${new Date().toISOString()} ${details.label}: ${details.error}`,
      `bin: ${details.bin}`,
      `argv: ${JSON.stringify(details.argv.map((arg) => (arg.length > 200 ? `${arg.slice(0, 200)}…` : arg)))}`,
      `cwd: ${details.cwd}`,
      `exit: code=${details.code} signal=${details.signal}`,
      `PATH: ${process.env.PATH ?? ""}`,
      `stderr:`,
      clean(details.stderr).slice(-8000) || "(empty)",
      "",
      "",
    ].join("\n");
    appendFileSync(join(CONFIG_DIR, "debug.log"), entry, "utf8");
  } catch {
    // Diagnostics must never take the run down with them.
  }
}

/** Ask every member the same prompt, all at once. */
export async function runAll(
  members: Member[],
  prompt: string,
  options: RunOptions,
): Promise<RunResult[]> {
  return Promise.all(members.map((member) => runMember(member, prompt, options)));
}
