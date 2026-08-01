import type { Config, Member } from "../config.js";
import { memberLabel } from "../config.js";
import { conversationMarkdown } from "../report.js";
import type { RunResult, RunState } from "../run.js";
import { runMember } from "../run.js";
import type { StoredSession, StoredTurn } from "../sessions.js";
import { newSessionId, saveSession } from "../sessions.js";
import { attributeSources, buildSynthesisPrompt } from "../synthesize.js";

export type Status = "pending" | "running" | "done" | "failed" | "skipped";

/** A member's participation in one turn. */
export interface MemberRun {
  key: string;
  label: string;
  status: Status;
  ms: number;
  bytes: number;
  text: string;
  error?: string;
}

export interface SynthesisRun {
  label: string;
  status: Status;
  ms: number;
  bytes: number;
  text: string;
  error?: string;
}

/** One prompt and everything the panel produced for it. */
export interface Turn {
  id: number;
  prompt: string;
  members: MemberRun[];
  synthesis: SynthesisRun | null;
  note: string | null;
  done: boolean;
}

/** A member as configured for the session, independent of any one turn. */
export interface PanelMember {
  key: string;
  label: string;
  member: Member;
  enabled: boolean;
}

export interface Snapshot {
  id: string;
  turns: Turn[];
  queue: string[];
  busy: boolean;
  panel: PanelMember[];
  synthesizer: string;
  /** Per-member wall-clock limit applied to every run. */
  timeoutMs: number;
  /** Session-level message, e.g. a failed autosave. */
  notice: string | null;
}

/**
 * A conversational session: prompts are submitted to a queue and drained one at
 * a time, so the user can keep typing while the panel is still working. Owns
 * all run orchestration and its own persistence; the UI only reads snapshots.
 */
export class ConsensusSession {
  private id: string;
  private title: string | undefined;
  private createdAt: string;
  private turns: Turn[] = [];
  private queue: string[] = [];
  private panel: PanelMember[];
  private synthesizer: Member;
  private pumping = false;
  private controller: AbortController | null = null;
  private notice: string | null = null;
  private nextId = 1;

  private listeners = new Set<() => void>();
  private snap: Snapshot;
  private pending: NodeJS.Timeout | null = null;

  constructor(
    config: Config,
    private cwd: string,
    private timeoutMs = config.timeoutMs,
  ) {
    this.id = newSessionId();
    this.createdAt = new Date().toISOString();
    this.panel = toPanel(config.members);
    this.synthesizer = config.synthesizer;
    this.snap = this.build();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): Snapshot => this.snap;

  get synthesizerLabel(): string {
    return memberLabel(this.synthesizer);
  }

  get busy(): boolean {
    return this.pumping;
  }

  get sessionId(): string {
    return this.id;
  }

  /** Queue a prompt. Runs immediately when idle, otherwise waits its turn. */
  submit(prompt: string): void {
    const text = prompt.trim();
    if (!text) return;
    this.queue.push(text);
    this.commit();
    if (!this.pumping) void this.pump();
  }

  /** Stop the running turn and drop anything still queued. */
  stop(): void {
    this.queue = [];
    this.controller?.abort();
    this.commit();
  }

  /** Drop everything queued without disturbing the turn already running. */
  clearQueue(): number {
    const dropped = this.queue.length;
    this.queue = [];
    this.commit();
    return dropped;
  }

  setTitle(title: string): void {
    this.title = title.trim() || undefined;
    this.commit();
    this.persist();
  }

  /** Bring a member into the panel for this session only. */
  addPanelMember(member: Member): boolean {
    const label = memberLabel(member);
    if (this.panel.some((entry) => entry.label === label)) return false;
    this.panel.push({ key: `${this.panel.length}:${label}`, label, member, enabled: true });
    this.commit();
    return true;
  }

  dropPanelMember(spec: string): boolean {
    if (this.panel.length === 1) return false;
    const index = this.panel.findIndex(
      (entry) => entry.label === spec || entry.member.provider === spec,
    );
    if (index < 0) return false;
    this.panel.splice(index, 1);
    this.commit();
    return true;
  }

  setSynthesizerMember(member: Member): void {
    this.synthesizer = member;
    this.commit();
  }

  /** The merged answer of the last turn, or its single answer when there was no merge. */
  get lastAnswer(): string {
    const turn = this.turns.at(-1);
    if (!turn) return "";
    if (turn.synthesis?.status === "done") return turn.synthesis.text;
    return turn.members.find((run) => run.status === "done")?.text ?? "";
  }

  /** Abandon this conversation and start a fresh one. */
  reset(): void {
    if (this.pumping) return;
    this.id = newSessionId();
    this.title = undefined;
    this.createdAt = new Date().toISOString();
    this.turns = [];
    this.nextId = 1;
    this.notice = null;
    this.commit();
  }

  /** Adopt a stored conversation, including the panel it was run with. */
  restore(stored: StoredSession): void {
    if (this.pumping) return;

    this.id = stored.id;
    this.title = stored.title;
    this.createdAt = stored.createdAt;
    this.timeoutMs = stored.timeoutMs;
    this.panel = toPanel(stored.panel);
    this.synthesizer = stored.synthesizer;
    this.notice = null;

    this.turns = stored.turns.map((turn, index) => ({
      id: index + 1,
      prompt: turn.prompt,
      members: turn.members.map((run) => ({
        key: `${index}:${run.label}`,
        label: run.label,
        status: run.status,
        ms: run.ms,
        bytes: run.bytes,
        text: run.text,
        error: run.error,
      })),
      synthesis: turn.synthesis
        ? {
            label: turn.synthesis.label,
            status: turn.synthesis.status,
            ms: turn.synthesis.ms,
            bytes: turn.synthesis.bytes,
            text: turn.synthesis.text,
            error: turn.synthesis.error,
          }
        : null,
      note: turn.note,
      done: true,
    }));
    this.nextId = this.turns.length + 1;
    this.commit();
  }

  togglePanelMember(index: number): void {
    const entry = this.panel[index];
    if (!entry) return;
    // Never let the panel empty out; there would be nothing to run.
    if (entry.enabled && this.panel.filter((m) => m.enabled).length === 1) return;
    entry.enabled = !entry.enabled;
    this.commit();
  }

  setSynthesizer(index: number): void {
    const entry = this.panel[index];
    if (!entry) return;
    this.synthesizer = entry.member;
    this.commit();
  }

  /** Change the per-member limit. Applies to the next turn, not one in flight. */
  setTimeLimit(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.timeoutMs = Math.round(ms);
    this.commit();
  }

  get lastPrompt(): string {
    return this.turns.at(-1)?.prompt ?? "";
  }

  /** Markdown for the whole conversation. */
  toMarkdown(): string {
    return conversationMarkdown(
      this.turns.map((turn) => ({
        prompt: turn.prompt,
        answers: turn.members.map(asResult),
        synthesis: turn.synthesis ? asResult(turn.synthesis) : null,
        synthesizedBy: turn.synthesis?.label ?? this.synthesizerLabel,
      })),
    );
  }

  toStored(): StoredSession {
    return {
      version: 1,
      id: this.id,
      title: this.title,
      createdAt: this.createdAt,
      updatedAt: new Date().toISOString(),
      cwd: this.cwd,
      panel: this.panel.map((entry) => entry.member),
      synthesizer: this.synthesizer,
      timeoutMs: this.timeoutMs,
      turns: this.turns.map(
        (turn): StoredTurn => ({
          prompt: turn.prompt,
          members: turn.members.map((run) => ({
            label: run.label,
            status: run.status,
            ms: run.ms,
            bytes: run.bytes,
            text: run.text,
            error: run.error,
          })),
          synthesis: turn.synthesis ? { ...turn.synthesis } : null,
          note: turn.note,
        }),
      ),
    };
  }

  /** Write to disk. Failures surface as a notice rather than passing silently. */
  persist(): void {
    if (this.turns.length === 0) return;
    try {
      saveSession(this.toStored());
      if (this.notice?.startsWith("could not save")) {
        this.notice = null;
        this.commit();
      }
    } catch (err) {
      this.notice = `could not save session: ${(err as Error).message}`;
      this.commit();
    }
  }

  private async pump(): Promise<void> {
    this.pumping = true;
    this.commit();

    while (this.queue.length > 0) {
      const prompt = this.queue.shift()!;
      this.commit();
      try {
        await this.runTurn(prompt);
      } catch (err) {
        const turn = this.turns.at(-1);
        if (turn) {
          turn.note = `Run failed: ${(err as Error).message}`;
          turn.done = true;
        }
        this.commit();
      }
      this.persist();
    }

    this.pumping = false;
    this.commit();
  }

  private async runTurn(prompt: string): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;

    const active = this.panel.filter((entry) => entry.enabled);
    const turn: Turn = {
      id: this.nextId++,
      prompt,
      members: active.map((entry) => ({
        key: entry.key,
        label: entry.label,
        status: "pending",
        ms: 0,
        bytes: 0,
        text: "",
      })),
      synthesis: null,
      note: null,
      done: false,
    };
    this.turns.push(turn);
    this.commit();

    const results = await Promise.all(
      active.map((entry) =>
        runMember(entry.member, prompt, {
          cwd: this.cwd,
          timeoutMs: this.timeoutMs,
          signal: controller.signal,
          onUpdate: (_, state) => this.applyState(turn, entry.key, state),
        }).then((result) => {
          this.applyResult(turn, entry.key, result);
          return result;
        }),
      ),
    );

    if (controller.signal.aborted) {
      turn.note = "Stopped.";
      turn.done = true;
      this.commit();
      return;
    }

    const answered = results.filter((result) => result.ok);

    if (answered.length > 1) {
      turn.synthesis = { label: this.synthesizerLabel, status: "running", ms: 0, bytes: 0, text: "" };
      this.commit();

      const result = await runMember(
        this.synthesizer,
        buildSynthesisPrompt({ prompt, answers: answered }),
        {
          cwd: this.cwd,
          timeoutMs: this.timeoutMs,
          signal: controller.signal,
          onUpdate: (_, state) => {
            if (!turn.synthesis) return;
            turn.synthesis.ms = state.ms;
            turn.synthesis.bytes = state.bytes;
            this.schedule();
          },
        },
      );

      const attributed = attributeSources(result.text, answered);
      turn.synthesis = {
        label: this.synthesizerLabel,
        status: result.ok ? "done" : "failed",
        ms: result.ms,
        bytes: attributed.length,
        text: attributed,
        error: result.error,
      };
    } else if (answered.length === 1) {
      turn.note = "Only one member answered — nothing to synthesize.";
    } else {
      turn.note = "Every member failed.";
    }

    turn.done = true;
    this.commit();
  }

  private applyState(turn: Turn, key: string, state: RunState): void {
    const run = turn.members.find((m) => m.key === key);
    if (!run) return;
    if (state.status === "running") run.status = "running";
    run.ms = state.ms;
    run.bytes = state.bytes;
    this.schedule();
  }

  private applyResult(turn: Turn, key: string, result: RunResult): void {
    const run = turn.members.find((m) => m.key === key);
    if (!run) return;
    run.status = result.ok ? "done" : "failed";
    run.ms = result.ms;
    run.bytes = result.text.length;
    run.text = result.text;
    run.error = result.error;
    this.commit();
  }

  private build(): Snapshot {
    return {
      id: this.id,
      turns: this.turns.map((turn) => ({
        ...turn,
        members: turn.members.map((run) => ({ ...run })),
        synthesis: turn.synthesis ? { ...turn.synthesis } : null,
      })),
      queue: [...this.queue],
      busy: this.pumping,
      panel: this.panel.map((entry) => ({ ...entry })),
      synthesizer: this.synthesizerLabel,
      timeoutMs: this.timeoutMs,
      notice: this.notice,
    };
  }

  /**
   * Coalesce the high-frequency elapsed-time updates. Members report progress
   * every ~120ms each, which would otherwise repaint far more often than a
   * terminal can usefully show.
   */
  private schedule(): void {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.commit();
    }, 100);
    this.pending.unref?.();
  }

  private commit(): void {
    if (this.pending) {
      clearTimeout(this.pending);
      this.pending = null;
    }
    this.snap = this.build();
    for (const listener of this.listeners) listener();
  }
}

function toPanel(members: Member[]): PanelMember[] {
  return members.map((member, index) => ({
    key: `${index}:${memberLabel(member)}`,
    label: memberLabel(member),
    member,
    enabled: true,
  }));
}

/** Adapt a stored/live run back into the shape the markdown writer expects. */
function asResult(run: { label: string; status: Status; ms: number; text: string; error?: string }): RunResult {
  return {
    member: { provider: run.label },
    label: run.label,
    ok: run.status === "done",
    text: run.text,
    ms: run.ms,
    error: run.error,
  };
}
