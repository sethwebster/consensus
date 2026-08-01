import { formatVolume } from "../format.js";
import type { MemberRun, Status, Turn } from "./session.js";
import { wrapLines } from "./wrap.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Span {
  text: string;
  color?: string;
  dim?: boolean;
}

export interface Line {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
  /** Set when one line carries several colours, e.g. per-model status. */
  spans?: Span[];
}

function glyph(status: Status, ms: number): string {
  if (status === "running") return FRAMES[Math.floor(ms / 80) % FRAMES.length]!;
  if (status === "done") return "✔";
  if (status === "failed") return "✖";
  return "·";
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Compact roll-up of the panel's progress, including how much each member has
 * returned so far — the volume climbs live, which is the clearest signal that a
 * slow member is actually producing something rather than hanging.
 *
 * Packed into as few lines as fit, breaking between members rather than through
 * one, so each entry keeps its own colour.
 */
function statusLines(turn: Turn, width: number): Line[] {
  const entries = turn.members.map((run) => {
    const spans = memberSpans(run);
    return { spans, length: spans.reduce((total, span) => total + span.text.length, 0) };
  });

  const lines: Line[] = [];
  let current: Span[] = [];
  let used = 0;

  const flush = () => {
    if (current.length === 0) return;
    lines.push({
      text: current.map((span) => span.text).join(""),
      spans: [{ text: "  " }, ...current],
    });
    current = [];
    used = 0;
  };

  for (const entry of entries) {
    const separator = current.length > 0 ? 3 : 0;
    if (current.length > 0 && used + separator + entry.length > width) flush();
    if (current.length > 0) {
      current.push({ text: " · ", dim: true });
      used += 3;
    }
    current.push(...entry.spans);
    used += entry.length;
  }
  flush();

  return lines;
}

function memberDetail(run: MemberRun, width: number): Line[] {
  const lines: Line[] = [
    { text: "", },
    { text: `  ${glyph(run.status, run.ms)} ${run.label}`, color: memberColor(run) },
  ];

  const body = run.status === "failed" ? (run.error ?? "failed") : run.text;
  for (const line of wrapLines(body, Math.max(10, width - 4))) {
    lines.push({ text: `    ${line}`, dim: run.status === "failed" });
  }
  return lines;
}

/**
 * Each model carries its own state in its colour, so a glance at the status
 * line says who is still thinking and who has landed: grey once asked but
 * silent, warm while its answer streams in, green when finished, red on
 * failure.
 */
const ASKED = "#7f849c";
const RESPONDING = "#f5a97f";
const LANDED = "#a6da95";
const FAILED = "#ed8796";

function memberColor(run: MemberRun): string {
  if (run.status === "failed") return FAILED;
  if (run.status === "done") return LANDED;
  return run.bytes > 0 ? RESPONDING : ASKED;
}

/**
 * Bytes at which the name is half filled. Chosen so a short answer shows clear
 * early movement and a long one keeps creeping rather than parking at the end.
 */
const HALFWAY = 900;

/** Gradient stops the name fades through: grey, warm, then landed green. */
const GRADIENT: Array<[number, number, number]> = [
  [127, 132, 156],
  [245, 169, 127],
  [166, 218, 149],
];

/** Letters over which the wavefront blends, rather than switching abruptly. */
const FADE = 2.5;

function hex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Grey at 0, through warm at the midpoint, to green at 1. */
function shade(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const half = clamped < 0.5 ? 0 : 1;
  const local = clamped < 0.5 ? clamped * 2 : (clamped - 0.5) * 2;
  const from = GRADIENT[half]!;
  const to = GRADIENT[half + 1]!;
  return hex([0, 1, 2].map((i) => from[i]! + (to[i]! - from[i]!) * local) as [number, number, number]);
}

/**
 * The name as a gradient that sweeps left to right while the answer streams.
 *
 * Letters start grey and fade toward green behind a soft wavefront, so the name
 * itself reads as the progress bar. Consecutive letters of the same shade are
 * merged into one span, which keeps a long name to a handful of spans rather
 * than one per character.
 */
function fadedLabel(label: string, progress: number): Span[] {
  const front = progress * label.length;
  const spans: Span[] = [];
  let start = 0;
  let colour = shade((front - 0) / FADE);

  for (let index = 1; index <= label.length; index++) {
    const next = index < label.length ? shade((front - index) / FADE) : null;
    if (next !== colour) {
      spans.push({ text: label.slice(start, index), color: colour });
      start = index;
      if (next !== null) colour = next;
    }
  }

  return spans;
}

/** One member's status, as spans so the name can fade mid-word. */
function memberSpans(run: MemberRun): Span[] {
  const volume = formatVolume(run.bytes);
  const tail = ` ${seconds(run.ms)}${volume ? ` ${volume}` : ""}`;
  const mark = `${glyph(run.status, run.ms)} `;

  // Settled members are a single colour — there is no progress left to show.
  if (run.status === "done" || run.status === "failed") {
    return [{ text: `${mark}${run.label}${tail}`, color: memberColor(run) }];
  }

  const progress = run.bytes > 0 ? run.bytes / (run.bytes + HALFWAY) : 0;
  return [
    { text: mark, color: shade(progress) },
    ...fadedLabel(run.label, progress),
    { text: tail, color: ASKED },
  ];
}

/** Paragraph markers the synthesizer uses to flag a minority view. */
const CALLOUT = /^\*\*(Dissent|Unresolved)\b/;

/**
 * Wrap a merged answer, tinting any dissent / unresolved callout so a minority
 * view reads as a distinct note rather than blending into the answer. The tint
 * runs to the end of that paragraph, since wrapping splits it across lines.
 */
export function answerLines(text: string, width: number): Line[] {
  const lines: Line[] = [];
  let inCallout = false;

  for (const line of wrapLines(text, width)) {
    if (CALLOUT.test(line.trim())) inCallout = true;
    else if (line.trim() === "") inCallout = false;

    if (line.trim() === "---") lines.push({ text: line, dim: true });
    else if (inCallout) lines.push({ text: line, color: "yellow" });
    else lines.push({ text: line });
  }

  return lines;
}

export interface Tab {
  title: string;
  body: string;
  failed: boolean;
  /** Merged answer, so dissent callouts get tinted. */
  consensus: boolean;
}

/** One turn split into the merged answer plus each member's own response. */
export function turnTabs(turn: Turn): Tab[] {
  const tabs: Tab[] = [];

  if (turn.synthesis?.status === "done") {
    tabs.push({ title: "consensus", body: turn.synthesis.text, failed: false, consensus: true });
  } else if (turn.synthesis?.status === "failed") {
    tabs.push({
      title: "consensus",
      body: `Synthesis failed: ${turn.synthesis.error ?? "unknown error"}`,
      failed: true,
      consensus: false,
    });
  }

  for (const run of turn.members) {
    if (run.status === "skipped" || run.status === "pending") continue;
    tabs.push({
      title: run.label,
      body: run.status === "failed" ? `Failed: ${run.error ?? "unknown error"}` : run.text,
      failed: run.status === "failed",
      consensus: false,
    });
  }

  return tabs;
}

/**
 * Flatten the conversation into renderable lines. Wrapping here (rather than
 * letting the terminal wrap) is what makes line-accurate scrolling possible.
 */
export function conversationLines(turns: Turn[], width: number, detail: boolean): Line[] {
  const lines: Line[] = [];

  for (const turn of turns) {
    if (lines.length > 0) lines.push({ text: "" });

    // The prompt is the user's own words — left in the default foreground.
    for (const [index, line] of wrapLines(turn.prompt, Math.max(10, width - 2)).entries()) {
      lines.push({ text: `${index === 0 ? "❯ " : "  "}${line}`, bold: true });
    }

    lines.push(...statusLines(turn, Math.max(10, width - 2)));

    // A collapsed ✖ hides whether a member timed out, lacked auth, or crashed.
    for (const run of turn.members) {
      if (run.status !== "failed") continue;
      for (const [index, line] of wrapLines(
        `${run.label} — ${run.error ?? "failed"}`,
        Math.max(10, width - 4),
      ).entries()) {
        lines.push({ text: `  ${index === 0 ? "✖ " : "  "}${line}`, color: "red" });
      }
    }

    if (turn.synthesis?.status === "running") {
      const volume = formatVolume(turn.synthesis.bytes);
      lines.push({
        text: `  ${glyph("running", turn.synthesis.ms)} synthesizing (${turn.synthesis.label}) ${seconds(turn.synthesis.ms)}${volume ? ` ${volume}` : ""}`,
        // The synthesizer is a model too, so it reads the same as the panel.
        color: turn.synthesis.bytes > 0 ? RESPONDING : ASKED,
      });
    }

    if (turn.synthesis?.status === "done") {
      lines.push({ text: "" });
      lines.push(...answerLines(turn.synthesis.text, width));
    }

    if (turn.synthesis?.status === "failed") {
      lines.push({ text: "" });
      lines.push({
        text: `  Synthesis failed: ${turn.synthesis.error ?? "unknown error"}`,
        color: "red",
      });
    }

    // With one answer there is no synthesis, so show that answer directly.
    if (!turn.synthesis && turn.done) {
      const only = turn.members.find((run) => run.status === "done");
      if (only) {
        lines.push({ text: "" });
        for (const line of wrapLines(only.text, width)) lines.push({ text: line });
      }
    }

    if (detail && turn.done) {
      for (const run of turn.members) {
        if (run.status === "skipped" || run.status === "pending") continue;
        lines.push(...memberDetail(run, width));
      }
    }

    if (turn.note) {
      lines.push({ text: `  ${turn.note}`, dim: true });
    }
  }

  return lines;
}
