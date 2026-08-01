import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, beforeEach } from "node:test";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const INSTALLER = fileURLToPath(new URL("../scripts/install-skill.mjs", import.meta.url));
const SKILL_SRC = fileURLToPath(new URL("../skill", import.meta.url));

const WORK = mkdtempSync(join(tmpdir(), "consensus-skill-"));
const SKILLS = join(WORK, "skills");

after(() => rmSync(WORK, { recursive: true, force: true }));
beforeEach(() => rmSync(SKILLS, { recursive: true, force: true }));

/** Run through the CLI subcommand, which is what a user actually types. */
function install(args: string[]) {
  const result = spawnSync(process.execPath, [CLI, "skill", "install", ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("the bundled skill is a directory containing SKILL.md", () => {
  assert.ok(existsSync(join(SKILL_SRC, "SKILL.md")));
});

test("skill install copies the skill into the requested directory", () => {
  const result = install(["--dir", SKILLS]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /installed consensus skill/);
  assert.equal(
    readFileSync(join(SKILLS, "consensus", "SKILL.md"), "utf8"),
    readFileSync(join(SKILL_SRC, "SKILL.md"), "utf8"),
  );
});

test("skill install creates a skills directory that does not exist yet", () => {
  const nested = join(SKILLS, "deep", "nested");
  assert.equal(install(["--dir", nested]).status, 0);
  assert.ok(existsSync(join(nested, "consensus", "SKILL.md")));
});

test("skill install refuses to clobber an existing install", () => {
  assert.equal(install(["--dir", SKILLS]).status, 0);

  const second = install(["--dir", SKILLS]);
  assert.equal(second.status, 1);
  assert.match(second.stderr, /already exists — pass --force/);
});

test("--force replaces an existing install, leaving no stale files", () => {
  assert.equal(install(["--dir", SKILLS]).status, 0);
  writeFileSync(join(SKILLS, "consensus", "STALE.md"), "old", "utf8");

  assert.equal(install(["--dir", SKILLS, "--force"]).status, 0);
  assert.ok(existsSync(join(SKILLS, "consensus", "SKILL.md")));
  assert.equal(existsSync(join(SKILLS, "consensus", "STALE.md")), false);
});

test("--print reports the source directory without installing anything", () => {
  const result = install(["--print"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), SKILL_SRC);
  assert.equal(existsSync(SKILLS), false);
});

test("--dir without a path is an error, not a silent default", () => {
  const result = install(["--dir"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--dir needs a path/);
});

test("an unknown flag is rejected rather than ignored", () => {
  const result = install(["--nope"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown argument: --nope/);
});

test("the CLI forwards the installer's exit code, so failures surface", () => {
  assert.equal(install(["--dir", SKILLS]).status, 0);
  assert.equal(install(["--dir", SKILLS]).status, 1);
});

test("a skill subcommand other than install prints usage and exits 2", () => {
  const result = spawnSync(process.execPath, [CLI, "skill", "uninstall"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: consensus skill install/);
});

test("`consensus skill` with no subcommand also prints usage", () => {
  const result = spawnSync(process.execPath, [CLI, "skill"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: consensus skill install/);
});

test("the standalone installer takes the same flags as the subcommand", () => {
  const result = spawnSync(process.execPath, [INSTALLER, "--dir", SKILLS], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.ok(existsSync(join(SKILLS, "consensus", "SKILL.md")));
});
