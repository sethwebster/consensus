import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// CONFIG_DIR is read from the environment at module load, so the temp home has
// to be in place before the first import of anything that reads it.
const HOME = mkdtempSync(join(tmpdir(), "consensus-config-"));
process.env.CONSENSUS_HOME = HOME;

const { CONFIG_PATH, DEFAULT_TIMEOUT_MS, defaultConfig, loadConfig, memberLabel, parseMember, pickSynthesizer, saveConfig } =
  await import("../dist/config.js");

after(() => rmSync(HOME, { recursive: true, force: true }));

test("parseMember splits provider from model at the first colon", () => {
  assert.deepEqual(parseMember("claude"), { provider: "claude" });
  assert.deepEqual(parseMember("ollama:qwen3"), { provider: "ollama", model: "qwen3" });
});

test("parseMember keeps colons inside a model name, e.g. ollama:qwen3:8b", () => {
  assert.deepEqual(parseMember("ollama:qwen3:8b"), { provider: "ollama", model: "qwen3:8b" });
});

test("parseMember rejects a provider that does not exist", () => {
  assert.throws(() => parseMember("nope"), /Unknown provider "nope"/);
});

test("memberLabel round-trips through parseMember", () => {
  for (const spec of ["claude", "ollama:qwen3:8b"]) {
    assert.equal(memberLabel(parseMember(spec)), spec);
  }
});

test("pickSynthesizer honours the preference order, not the panel order", () => {
  const members = [{ provider: "ollama", model: "qwen3" }, { provider: "gemini" }, { provider: "claude" }];
  assert.deepEqual(pickSynthesizer(members), { provider: "claude" });
});

test("pickSynthesizer falls back to the first member, then to claude", () => {
  assert.deepEqual(pickSynthesizer([{ provider: "crush" }, { provider: "goose" }]), { provider: "crush" });
  assert.deepEqual(pickSynthesizer([]), { provider: "claude" });
});

test("pickSynthesizer returns a copy, so editing it cannot mutate the panel", () => {
  const members = [{ provider: "claude" }];
  const picked = pickSynthesizer(members);
  picked.model = "opus";
  assert.deepEqual(members[0], { provider: "claude" });
});

test("defaultConfig takes every ready CLI and the first model of each", () => {
  const config = defaultConfig([
    { provider: { id: "claude", label: "Claude Code", bin: "claude", argv: () => [] }, path: "/bin/claude", models: [] },
    {
      provider: { id: "ollama", label: "Ollama", bin: "ollama", needsModel: true, argv: () => [] },
      path: "/bin/ollama",
      models: ["qwen3:8b", "llama3"],
    },
  ]);

  assert.deepEqual(config.members, [{ provider: "claude" }, { provider: "ollama", model: "qwen3:8b" }]);
  assert.deepEqual(config.synthesizer, { provider: "claude" });
  assert.equal(config.timeoutMs, DEFAULT_TIMEOUT_MS);
});

test("defaultConfig drops a model-requiring CLI that has no models installed", () => {
  const config = defaultConfig([
    { provider: { id: "ollama", label: "Ollama", bin: "ollama", needsModel: true, argv: () => [] }, path: "/bin/ollama", models: [] },
  ]);
  assert.deepEqual(config.members, []);
});

test("loadConfig returns null when no config has been written yet", () => {
  assert.equal(loadConfig(), null);
});

test("saveConfig then loadConfig round-trips the panel", () => {
  const config = { members: [{ provider: "claude" }], synthesizer: { provider: "claude" }, timeoutMs: 1234 };
  saveConfig(config);
  assert.deepEqual(loadConfig(), config);
});

test("loadConfig fills in defaults for a partial config file", () => {
  writeFileSync(CONFIG_PATH, JSON.stringify({ members: [{ provider: "codex" }] }), "utf8");
  assert.deepEqual(loadConfig(), {
    members: [{ provider: "codex" }],
    synthesizer: { provider: "claude" },
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
});

test("loadConfig reports a corrupt config rather than silently ignoring it", () => {
  writeFileSync(CONFIG_PATH, "{ not json", "utf8");
  assert.throws(() => loadConfig(), /Could not read/);
});
