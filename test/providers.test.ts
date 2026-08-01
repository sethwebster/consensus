import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test, { after } from "node:test";
import { PROVIDERS, getProvider, which } from "../dist/providers.js";

const BIN = mkdtempSync(join(tmpdir(), "consensus-which-"));
after(() => rmSync(BIN, { recursive: true, force: true }));

function executable(name: string): string {
  const path = join(BIN, name);
  writeFileSync(path, "#!/bin/sh\n", "utf8");
  chmodSync(path, 0o755);
  return path;
}

test("every provider has a unique id and a non-empty binary", () => {
  const ids = PROVIDERS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const provider of PROVIDERS) assert.ok(provider.bin.length > 0, provider.id);
});

test("every provider passes the prompt through to its argv", () => {
  for (const provider of PROVIDERS) {
    const argv = provider.argv("PROMPT", provider.needsModel ? "some-model" : undefined);
    assert.ok(argv.includes("PROMPT"), `${provider.id} dropped the prompt`);
  }
});

test("every provider puts the prompt last, so no flag can swallow it", () => {
  for (const provider of PROVIDERS) {
    const argv = provider.argv("PROMPT", provider.needsModel ? "some-model" : undefined);
    assert.equal(argv.at(-1), "PROMPT", `${provider.id} does not end with the prompt`);
  }
});

test("a provider takes the model only when one is given", () => {
  const claude = getProvider("claude")!;
  assert.deepEqual(claude.argv("hi"), ["--print", "hi"]);
  assert.deepEqual(claude.argv("hi", "opus"), ["--model", "opus", "--print", "hi"]);
});

test("getProvider looks up by id and reports an unknown one as undefined", () => {
  assert.equal(getProvider("claude")?.label, "Claude Code");
  assert.equal(getProvider("nope"), undefined);
});

test("which finds an executable on PATH and ignores a non-executable file", () => {
  const path = executable("findme");
  writeFileSync(join(BIN, "notexec"), "", "utf8");
  chmodSync(join(BIN, "notexec"), 0o644);

  const before = process.env.PATH;
  process.env.PATH = `${BIN}${delimiter}${before ?? ""}`;
  try {
    assert.equal(which("findme"), path);
    assert.equal(which("notexec"), null);
    assert.equal(which("definitely-not-installed-xyz"), null);
  } finally {
    process.env.PATH = before;
  }
});

test("which takes a path with a slash as-is, bypassing PATH", () => {
  const path = executable("direct");
  assert.equal(which(path), path);
  assert.equal(which(join(BIN, "missing")), null);
});
