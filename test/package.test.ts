import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("..", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8")) as {
  name: string;
  bin: Record<string, string>;
  files: string[];
  publishConfig?: { access?: string };
};

/** What `npm publish` would actually upload. */
const tarball = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: new URL(".", ROOT), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
)[0] as { files: Array<{ path: string }> };

const shipped = new Set(tarball.files.map((file) => file.path));

test("the published package contains every binary it declares", () => {
  for (const [name, path] of Object.entries(manifest.bin)) {
    assert.ok(shipped.has(path), `bin "${name}" points at ${path}, which is not in the tarball`);
  }
});

test("the published package contains the skill the installer copies", () => {
  assert.ok(shipped.has("skill/SKILL.md"));
  assert.ok(shipped.has("scripts/install-skill.mjs"));
});

test("a scoped package must publish with public access to be installable", () => {
  if (!manifest.name.startsWith("@")) return;
  assert.equal(manifest.publishConfig?.access, "public");
});

test("tests and build config stay out of the tarball", () => {
  for (const path of shipped) {
    assert.ok(!path.startsWith("test/"), `${path} should not ship`);
    assert.ok(!path.startsWith(".github/"), `${path} should not ship`);
    assert.notEqual(path, "tsconfig.test.json");
  }
});
