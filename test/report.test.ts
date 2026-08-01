import assert from "node:assert/strict";
import test from "node:test";
import { conversationMarkdown, transcript, transcriptFilename } from "../dist/report.js";
import type { RunResult } from "../dist/run.js";

function answer(label: string, text: string, ok = true, error?: string): RunResult {
  return { member: { provider: label }, label, ok, text, ms: 1500, ...(error ? { error } : {}) };
}

const run = {
  prompt: "design a rate limiter",
  answers: [answer("claude", "token bucket"), answer("codex", "", false, "not logged in")],
  synthesis: answer("consensus", "use a token bucket"),
  synthesizedBy: "claude",
};

test("transcript renders prompt, consensus, and each response under one title", () => {
  const md = transcript(run);
  assert.match(md, /^# consensus\n/);
  assert.match(md, /## Prompt\n\ndesign a rate limiter/);
  assert.match(md, /## Consensus\n\n_Synthesized by claude_\n\nuse a token bucket/);
  assert.match(md, /### claude\n\n_1\.5s_\n\ntoken bucket/);
});

test("transcript reports a failed member's error instead of its empty body", () => {
  assert.match(transcript(run), /### codex\n\n_failed — not logged in_/);
});

test("transcript explains a failed synthesis rather than dropping the section", () => {
  const md = transcript({ ...run, synthesis: answer("consensus", "", false, "timed out") });
  assert.match(md, /## Consensus\n\n_Synthesis failed — timed out_/);
  assert.doesNotMatch(md, /_Synthesized by/);
});

test("transcript omits the consensus section entirely when there was no synthesis", () => {
  assert.doesNotMatch(transcript({ ...run, synthesis: null }), /## Consensus/);
});

test("conversationMarkdown numbers turns and demotes their headings one level", () => {
  const md = conversationMarkdown([run, { ...run, prompt: "second" }]);
  assert.match(md, /^# consensus session\n/);
  assert.match(md, /## Turn 1\n\n### Prompt/);
  assert.match(md, /## Turn 2\n\n### Prompt\n\nsecond/);
  assert.match(md, /#### claude/);
});

test("conversationMarkdown says so when nothing has been asked yet", () => {
  assert.equal(conversationMarkdown([]), "# consensus session\n\n_No turns yet._\n");
});

test("transcriptFilename slugs the prompt and keeps it filesystem-safe", () => {
  assert.equal(transcriptFilename("Why is the SKY blue?", "20260731"), "consensus-why-is-the-sky-blue-20260731.md");
});

test("transcriptFilename caps the slug and survives a prompt with no letters", () => {
  const long = transcriptFilename("a".repeat(80), "s");
  assert.equal(long, `consensus-${"a".repeat(40)}-s.md`);
  assert.equal(transcriptFilename("!!! ???", "s"), "consensus-consensus-s.md");
});
