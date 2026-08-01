import pc from "picocolors";
import { formatVolume } from "./format.js";
import type { RunState } from "./run.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Multi-line progress board: one row per panel member, redrawn in place on a
 * TTY and degraded to plain state-change lines when piped.
 */
export class Board {
  private rows = new Map<string, RunState>();
  private order: string[] = [];
  private frame = 0;
  private painted = 0;
  private ticker?: NodeJS.Timeout;
  private readonly tty: boolean;

  constructor(labels: string[], private stream: NodeJS.WriteStream = process.stderr) {
    this.tty = Boolean(stream.isTTY) && !process.env.CONSENSUS_PLAIN;
    this.order = [...labels];
    for (const label of labels) this.rows.set(label, { status: "running", bytes: 0, ms: 0 });
  }

  start(): void {
    if (!this.tty) return;
    this.stream.write(hideCursor);
    this.paint();
    this.ticker = setInterval(() => {
      this.frame = (this.frame + 1) % FRAMES.length;
      this.paint();
    }, 80);
  }

  update(label: string, state: RunState): void {
    const previous = this.rows.get(label);
    this.rows.set(label, state);
    if (this.tty) {
      this.paint();
    } else if (previous?.status !== state.status && state.status !== "running") {
      this.stream.write(`${this.line(label, state, false)}\n`);
    }
  }

  stop(): void {
    if (this.ticker) clearInterval(this.ticker);
    if (!this.tty) return;
    this.paint();
    this.stream.write(showCursor);
  }

  /** Erase the board so final output starts on a clean screen. */
  clear(): void {
    if (this.ticker) clearInterval(this.ticker);
    if (!this.tty) return;
    this.stream.write(`\u001B[${this.painted}A\u001B[0J${showCursor}`);
    this.painted = 0;
  }

  private paint(): void {
    const body = this.order
      .map((label) => this.line(label, this.rows.get(label)!, true))
      .join("\n");
    const prefix = this.painted ? `\u001B[${this.painted}A\u001B[0J` : "";
    this.stream.write(`${prefix}${body}\n`);
    this.painted = this.order.length;
  }

  private line(label: string, state: RunState, spin: boolean): string {
    const name = label.padEnd(Math.min(28, Math.max(...this.order.map((l) => l.length))));
    const secs = `${(state.ms / 1000).toFixed(1)}s`;

    if (state.status === "running") {
      const mark = spin ? pc.cyan(FRAMES[this.frame]!) : pc.cyan("·");
      const size = state.bytes ? pc.dim(` ${formatVolume(state.bytes)}`) : "";
      return `  ${mark} ${name} ${pc.dim(secs)}${size}`;
    }
    if (state.status === "done") {
      return `  ${pc.green("✔")} ${name} ${pc.dim(secs)} ${pc.dim(formatVolume(state.bytes))}`;
    }
    return `  ${pc.red("✖")} ${name} ${pc.dim(secs)} ${pc.red(truncate(state.error ?? "failed", 60))}`;
  }
}


function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const hideCursor = "\u001B[?25l";
const showCursor = "\u001B[?25h";

export function heading(text: string): string {
  return pc.bold(pc.cyan(text));
}

export function rule(label?: string): string {
  const width = Math.min(process.stdout.columns || 80, 80);
  if (!label) return pc.dim("─".repeat(width));
  const dashes = Math.max(0, width - label.length - 3);
  return pc.dim(`── ${label} ${"─".repeat(dashes)}`.slice(0, width));
}
