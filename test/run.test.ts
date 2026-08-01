import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test, { after } from "node:test";
import { cleanOutput, explainFailure, runAll, runMember } from "../dist/run.js";

const BIN = mkdtempSync(join(tmpdir(), "consensus-bin-"));
const HOME = mkdtempSync(join(tmpdir(), "consensus-run-"));
process.env.CONSENSUS_HOME = HOME;
process.env.PATH = `${BIN}${delimiter}${process.env.PATH ?? ""}`;

after(() => {
  rmSync(BIN, { recursive: true, force: true });
  rmSync(HOME, { recursive: true, force: true });
});

/** Stand in for a model CLI, so a run can be exercised without one installed. */
function fakeCli(name: string, body: string): void {
  const path = join(BIN, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`, "utf8");
  chmodSync(path, 0o755);
}

const options = { cwd: process.cwd(), timeoutMs: 5_000 };

test("cleanOutput strips colour codes, hyperlinks, and carriage returns", () => {
  assert.equal(cleanOutput("[31mred[0m"), "red");
  assert.equal(cleanOutput("]8;;http://xlink]8;;"), "link");
  assert.equal(cleanOutput("a\r\nb"), "a\nb");
  assert.equal(cleanOutput("  padded  "), "padded");
});

test("explainFailure prefers a line that reads like an error", () => {
  assert.equal(explainFailure("starting up\nError: not logged in\ndone", 1), "Error: not logged in");
  assert.equal(explainFailure("please run auth login\nrate limit exceeded", 1), "rate limit exceeded");
});

test("explainFailure skips stack frames, which crowd out the real message", () => {
  assert.equal(explainFailure("Error: boom\n    at foo (x.js:1:1)\n    at bar (y.js:2:2)", 1), "Error: boom");
});

test("explainFailure falls back to the last line, then to the exit code", () => {
  assert.equal(explainFailure("noise\nlast thing printed", 3), "last thing printed");
  assert.equal(explainFailure("", 3), "exited with code 3");
  assert.equal(explainFailure("   \n  ", null), "exited with code null");
});

test("explainFailure caps a runaway message", () => {
  assert.equal(explainFailure(`Error: ${"x".repeat(500)}`, 1).length, 300);
});

test("runMember captures a member's stdout as its answer", async () => {
  fakeCli("claude", 'echo "token bucket"');
  const result = await runMember({ provider: "claude" }, "how?", options);

  assert.equal(result.ok, true);
  assert.equal(result.text, "token bucket");
  assert.equal(result.label, "claude");
  assert.ok(result.ms >= 0);
});

test("runMember reports the stderr headline when the CLI exits non-zero", async () => {
  fakeCli("claude", 'echo "Error: not logged in" >&2; exit 1');
  const result = await runMember({ provider: "claude" }, "how?", options);

  assert.equal(result.ok, false);
  assert.equal(result.error, "Error: not logged in");
});

test("runMember treats a silent success as a failure, not an empty answer", async () => {
  fakeCli("claude", "exit 0");
  const result = await runMember({ provider: "claude" }, "how?", options);

  assert.equal(result.ok, false);
  assert.equal(result.error, "returned an empty response");
});

test("runMember fails fast when the CLI is not installed", async () => {
  const result = await runMember({ provider: "goose" }, "how?", options);
  assert.equal(result.ok, false);
  assert.equal(result.error, "`goose` is not on PATH");
});

test("runMember refuses an unknown provider and a model-less local model", async () => {
  const unknown = await runMember({ provider: "nope" }, "how?", options);
  assert.equal(unknown.error, 'Unknown provider "nope"');

  const modelless = await runMember({ provider: "ollama" }, "how?", options);
  assert.match(modelless.error!, /requires a model/);
});

test("runMember kills a member that overruns the timeout", async () => {
  fakeCli("claude", "sleep 30");
  const result = await runMember({ provider: "claude" }, "how?", { ...options, timeoutMs: 250 });

  assert.equal(result.ok, false);
  assert.match(result.error!, /timed out after 0s/);
});

test("runMember stops a member when the caller aborts", async () => {
  fakeCli("claude", "sleep 30");
  const controller = new AbortController();
  const pending = runMember({ provider: "claude" }, "how?", { ...options, signal: controller.signal });
  controller.abort();

  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error, "cancelled");
});

test("runMember reports progress as bytes arrive", async () => {
  fakeCli("claude", 'echo "hello"');
  const states: string[] = [];
  const result = await runMember({ provider: "claude" }, "how?", {
    ...options,
    onUpdate: (_label, state) => states.push(state.status),
  });

  assert.equal(result.ok, true);
  assert.equal(states.at(0), "running");
  assert.equal(states.at(-1), "done");
});

test("runAll answers every member, keeping one failure from sinking the rest", async () => {
  fakeCli("claude", 'echo "from claude"');
  fakeCli("codex", "exit 1");

  const results = await runAll([{ provider: "claude" }, { provider: "codex" }], "how?", options);

  assert.deepEqual(results.map((r) => r.label), ["claude", "codex"]);
  assert.equal(results[0]!.ok, true);
  assert.equal(results[1]!.ok, false);
});
