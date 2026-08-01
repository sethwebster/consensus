import assert from "node:assert/strict";
import test from "node:test";
import { COMMANDS, completions, label, resolveCommand } from "../dist/tui/commands.js";

test("every command has a unique name", () => {
  const names = COMMANDS.map((command) => command.name);
  assert.equal(new Set(names).size, names.length);
});

test("completions offer every command matching the typed prefix", () => {
  assert.deepEqual(completions("/re").map((c) => c.name), ["retry", "resume", "rename"]);
  assert.deepEqual(completions("/res").map((c) => c.name), ["resume"]);
  assert.equal(completions("/").length, COMMANDS.length);
});

test("completions stop once the draft is no longer a bare command", () => {
  assert.deepEqual(completions("/synth codex"), []);
  assert.deepEqual(completions("hello"), []);
  assert.deepEqual(completions("/Save"), []);
});

test("resolveCommand accepts an exact name or an unambiguous prefix", () => {
  assert.equal(resolveCommand("save")?.name, "save");
  assert.equal(resolveCommand("res")?.name, "resume");
});

test("resolveCommand refuses an ambiguous prefix and an unknown name", () => {
  assert.equal(resolveCommand("re"), null);
  assert.equal(resolveCommand("nope"), null);
});

test("label renders the command with its argument hint", () => {
  assert.equal(label({ name: "synth", args: "<spec>", help: "" }), "/synth <spec>");
  assert.equal(label({ name: "help", help: "" }), "/help");
});
