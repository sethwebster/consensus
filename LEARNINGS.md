# LEARNINGS

Facts discovered about this codebase and its tooling. What is true, not what to
do about it — instructions live in [DIARY.md](DIARY.md).

## Test harness

- Node cannot run the TS sources directly. Type stripping does **not** rewrite
  a `.js` specifier to `.ts`, so `import "../src/config.js"` fails with
  `ERR_MODULE_NOT_FOUND`, and importing `../src/config.ts` fails too — that
  file's own internal `.js` imports break the same way.
- Tests therefore import from `dist/`, which has real `.js` files and matching
  `.d.ts` types. Consequence: the suite tests the shipped artifact.
- `node --test "test/**/*.test.ts"` runs TS test files with no extra
  dependency; `tsc -p tsconfig.test.json` typechecks them against `dist/*.d.ts`.
- Full clean run (build + typecheck + 141 tests) takes about 1.5s.

## Behaviours pinned by tests that were surprising

- `wrapLines` collapses runs of spaces: a tab becomes two spaces and then
  `split(" ")` swallows them, so `"a\tb"` wraps to `"a b"`, not `"a  b"`.
- `attributeSources` replaces the entire `Response B` token with the model
  label, so a dissent line reads `(ollama:qwen3)` — not `(Response ollama:qwen3)`.
- `consensus resume` hits the TTY guard *before* it looks for a session, so in a
  pipe it exits 2 with the terminal message rather than "no saved sessions".
- Command prefix resolution: `save` starts with `sa`, so `/se` is unambiguous
  (`sessions`). The genuinely ambiguous prefix is `re` → retry/resume/rename.

## Code structure

- `src/cli.ts` self-executes `main()` at import, so it can never be imported by
  a test — its behaviour is covered by spawning `dist/cli.js`.
- `parseArgs` in `cli.ts` is strict about unknown options, so a subcommand
  carrying its own flags (`skill install` → `--project`, `--dir`, `--force`,
  `--print`) has to be dispatched before `parseArgs` runs.
- `scripts/install-skill.mjs` calls `main()` on import with no guard, so it must
  be spawned as a child process rather than imported.
- `dist/cli.js` finds that installer via
  `new URL("../scripts/install-skill.mjs", import.meta.url)`, which resolves
  because `scripts/` ships in the package `files` list next to `dist/`.
- `CONFIG_DIR` is read from `CONSENSUS_HOME` at module load, so a test must set
  the env var before its first `import` of anything that reads it — which means
  `await import()`, since static imports hoist.
- A failing panel member appends its resolved binary, argv, PATH, exit status,
  and full stderr to `CONFIG_DIR/debug.log`.

## Repo conventions

- `CLAUDE.md` is a symlink to `AGENTS.md`, and it changed three times during one
  session — a snapshot taken at session start goes stale.
