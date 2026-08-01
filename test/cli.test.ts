import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const BIN = mkdtempSync(join(tmpdir(), "consensus-cli-bin-"));
const HOME = mkdtempSync(join(tmpdir(), "consensus-cli-home-"));

after(() => {
  rmSync(BIN, { recursive: true, force: true });
  rmSync(HOME, { recursive: true, force: true });
});

/** Stand in for a model CLI so a whole run can happen with none installed. */
function fakeCli(name: string, body: string): void {
  const path = join(BIN, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`, "utf8");
  chmodSync(path, 0o755);
}

function run(args: string[], input?: string) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    input: input ?? "",
    env: {
      ...process.env,
      CONSENSUS_HOME: HOME,
      PATH: `${BIN}${delimiter}${process.env.PATH ?? ""}`,
      NO_COLOR: "1",
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("--version prints the version from package.json", () => {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  const result = run(["--version"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), version);
});

test("--help lists the commands, including skill install", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /consensus \[options\] <prompt\.\.\.>/);
  assert.match(result.stdout, /skill install/);
});

test("a run with no prompt at all exits 2 and says how to give one", () => {
  const result = run([]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /No prompt given/);
});

test("an unknown provider in -m is reported, not silently dropped", () => {
  const result = run(["-m", "nope", "hi"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown provider "nope"/);
});

test("a bad --timeout is rejected rather than becoming NaN", () => {
  const result = run(["-m", "claude", "-t", "abc", "hi"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid --timeout/);
});

test("--json emits the members and the synthesis as machine-readable output", () => {
  fakeCli("claude", 'echo "answer from claude"');
  fakeCli("codex", 'echo "answer from codex"');

  const result = run(["-m", "claude", "-m", "codex", "-s", "claude", "--json", "why?"]);
  assert.equal(result.status, 0);

  const payload = JSON.parse(result.stdout) as {
    prompt: string;
    members: Array<{ label: string; ok: boolean; response: string; error: string | null }>;
    synthesis: { by: string; ok: boolean; text: string } | null;
  };

  assert.equal(payload.prompt, "why?");
  assert.deepEqual(payload.members.map((m) => m.label), ["claude", "codex"]);
  assert.equal(payload.members[0]!.ok, true);
  assert.equal(payload.members[0]!.response, "answer from claude");
  assert.equal(payload.members[0]!.error, null);
  assert.equal(payload.synthesis?.by, "claude");
  assert.equal(payload.synthesis?.ok, true);
});

test("--no-synth returns the raw answers with no merge step", () => {
  fakeCli("claude", 'echo "raw claude"');
  fakeCli("codex", 'echo "raw codex"');

  const result = run(["-m", "claude", "-m", "codex", "--no-synth", "--json", "why?"]);
  const payload = JSON.parse(result.stdout) as { synthesis: unknown };
  assert.equal(payload.synthesis, null);
});

test("a piped prompt is the whole prompt when nothing else is given", () => {
  fakeCli("claude", 'echo "ok"');
  const result = run(["-m", "claude", "--json"], "piped question");
  assert.equal(JSON.parse(result.stdout).prompt, "piped question");
});

test("a piped prompt is ignored unless asked for, and says so", () => {
  fakeCli("claude", 'echo "ok"');
  const result = run(["-m", "claude", "--json", "inline question"], "piped question");

  assert.equal(JSON.parse(result.stdout).prompt, "inline question");
  assert.match(result.stderr, /stdin not read/);
});

test("`-` folds the pipe in ahead of the inline words", () => {
  fakeCli("claude", 'echo "ok"');
  const result = run(["-m", "claude", "--json", "-", "critique this"], "the spec");
  assert.equal(JSON.parse(result.stdout).prompt, "the spec\n\ncritique this");
});

test("-f reads the prompt from a file", () => {
  fakeCli("claude", 'echo "ok"');
  const file = join(HOME, "prompt.txt");
  writeFileSync(file, "from a file\n", "utf8");

  const result = run(["-m", "claude", "--json", "-f", file]);
  assert.equal(JSON.parse(result.stdout).prompt, "from a file");
});

test("-o writes a markdown transcript alongside the normal output", () => {
  fakeCli("claude", 'echo "the answer"');
  const out = join(HOME, "transcript.md");

  const result = run(["-m", "claude", "-o", out, "why?"]);
  assert.equal(result.status, 0);

  const markdown = readFileSync(out, "utf8");
  assert.match(markdown, /^# consensus/);
  assert.match(markdown, /## Prompt\n\nwhy\?/);
  assert.match(markdown, /### claude/);
});

test("a panel where every member fails exits 1 and names each failure", () => {
  fakeCli("claude", 'echo "Error: not logged in" >&2; exit 1');
  const result = run(["-m", "claude", "why?"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Every panel member failed/);
  assert.match(result.stderr, /claude: Error: not logged in/);
});

test("one surviving member is reported as-is, with nothing to synthesize", () => {
  fakeCli("claude", 'echo "the only answer"');
  fakeCli("codex", "exit 1");

  const result = run(["-m", "claude", "-m", "codex", "why?"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /the only answer/);
  assert.match(result.stderr, /nothing to synthesize/);
});

test("the REPL refuses to start without a terminal, pointing at the plain run", () => {
  const result = run(["tui"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /needs an interactive terminal/);
});

test("resume needs a terminal too — it reopens the REPL, not a plain run", () => {
  const result = run(["resume"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /needs an interactive terminal/);
});

test("sessions lists nothing before any session exists", () => {
  const result = run(["sessions"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No sessions yet/);
});

test("sessions rm requires an id", () => {
  const result = run(["sessions", "rm"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: consensus sessions rm <id>/);
});

test("config reports there is none before init has run", () => {
  const result = run(["config"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No config at/);
});

test("detect reports which CLIs are on PATH", () => {
  fakeCli("claude", "exit 0");
  const result = run(["detect"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /claude/);
});
