import assert from "node:assert/strict";
import test from "node:test";
import { answerLines, conversationLines, turnTabs } from "../dist/tui/lines.js";
import type { MemberRun, Turn } from "../dist/tui/session.js";

function member(label: string, status: MemberRun["status"], extra: Partial<MemberRun> = {}): MemberRun {
  return { label, status, ms: 1000, bytes: 0, text: "", ...extra } as MemberRun;
}

function turn(overrides: Partial<Turn> = {}): Turn {
  return {
    prompt: "why?",
    members: [member("claude", "done", { text: "because" })],
    synthesis: null,
    note: null,
    done: true,
    ...overrides,
  } as Turn;
}

const text = (lines: Array<{ text: string }>) => lines.map((line) => line.text).join("\n");

test("answerLines tints a dissent callout through to the end of its paragraph", () => {
  const lines = answerLines("the answer\n\n**Dissent** (claude): it\nargues otherwise\n\nafter", 40);
  const dissent = lines.filter((line) => line.color === "yellow").map((line) => line.text);

  assert.deepEqual(dissent, ["**Dissent** (claude): it", "argues otherwise"]);
  assert.ok(lines.some((line) => line.text === "the answer" && !line.color));
  assert.ok(lines.some((line) => line.text === "after" && !line.color));
});

test("answerLines tints an unresolved callout the same way", () => {
  const lines = answerLines("**Unresolved:** they split", 40);
  assert.equal(lines[0]!.color, "yellow");
});

test("answerLines dims the rule that introduces a callout", () => {
  const lines = answerLines("answer\n\n---\n\n**Dissent** (a): no", 40);
  const rule = lines.find((line) => line.text.trim() === "---")!;
  assert.equal(rule.dim, true);
  assert.equal(rule.color, undefined);
});

test("turnTabs leads with the merged answer, then each member that ran", () => {
  const tabs = turnTabs(
    turn({
      synthesis: member("claude", "done", { text: "merged" }),
      members: [member("claude", "done", { text: "a" }), member("codex", "failed", { error: "boom" })],
    }),
  );

  assert.deepEqual(tabs.map((tab) => tab.title), ["consensus", "claude", "codex"]);
  assert.equal(tabs[0]!.consensus, true);
  assert.equal(tabs[2]!.body, "Failed: boom");
  assert.equal(tabs[2]!.failed, true);
});

test("turnTabs shows a failed synthesis as a tab, but not as the merged answer", () => {
  const tabs = turnTabs(turn({ synthesis: member("claude", "failed", { error: "timed out" }) }));
  assert.equal(tabs[0]!.body, "Synthesis failed: timed out");
  assert.equal(tabs[0]!.consensus, false);
});

test("turnTabs omits members that never ran", () => {
  const tabs = turnTabs(turn({ members: [member("claude", "skipped"), member("codex", "pending")] }));
  assert.deepEqual(tabs, []);
});

test("conversationLines marks the prompt and indents its continuation", () => {
  const lines = conversationLines([turn({ prompt: "a fairly long question that wraps" })], 22, false);
  assert.match(lines[0]!.text, /^❯ a fairly long/);
  assert.match(lines[1]!.text, /^ {2}\S/);
  assert.equal(lines[0]!.bold, true);
});

test("conversationLines spells out why a member failed, not just a mark", () => {
  const lines = conversationLines([turn({ members: [member("codex", "failed", { error: "not logged in" })] })], 60, false);
  assert.match(text(lines), /✖ codex — not logged in/);
});

test("conversationLines shows the lone answer when there was nothing to merge", () => {
  const lines = conversationLines([turn({ members: [member("claude", "done", { text: "solo answer" })] })], 60, false);
  assert.match(text(lines), /solo answer/);
});

test("conversationLines hides per-member detail until it is asked for", () => {
  const one = turn({
    synthesis: member("claude", "done", { text: "merged" }),
    members: [member("claude", "done", { text: "the raw claude answer" })],
  });

  assert.doesNotMatch(text(conversationLines([one], 60, false)), /the raw claude answer/);
  assert.match(text(conversationLines([one], 60, true)), /the raw claude answer/);
});

test("conversationLines separates turns with a blank line", () => {
  const lines = conversationLines([turn({ prompt: "first" }), turn({ prompt: "second" })], 60, false);
  const second = lines.findIndex((line) => line.text.startsWith("❯ second"));
  assert.equal(lines[second - 1]!.text, "");
});

test("conversationLines appends a turn's note, dimmed", () => {
  const lines = conversationLines([turn({ note: "queued while busy" })], 60, false);
  const note = lines.at(-1)!;
  assert.match(note.text, /queued while busy/);
  assert.equal(note.dim, true);
});

test("conversationLines renders nothing for an empty conversation", () => {
  assert.deepEqual(conversationLines([], 60, false), []);
});
