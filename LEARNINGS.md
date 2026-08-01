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

## Release pipeline

- `.github/workflows/ci.yml` runs the suite on every push and PR; the release
  job is `needs: test`, so nothing publishes from a red build.
- Publishing uses npm trusted publishing (OIDC), not a token.
  `@semantic-release/npm` 13.1.5 verifies it by trading a GitHub ID token for a
  registry token, and `verify-auth.js` returns early on success — so no
  `NPM_TOKEN` is read. It then discards that token: the publish itself relies on
  the npm CLI auto-detecting trusted publishing, which needs npm 11.5.1+.
- The release job needs `id-token: write` for that exchange, and `contents:
  write` (not `read`) because `@semantic-release/git` pushes the version bump,
  CHANGELOG, and tag back to `main`.
- npm matches the OIDC claim against a trusted publisher registered for an exact
  workflow filename, so renaming `ci.yml` breaks publishing.
- A scoped package publishes as restricted unless `publishConfig.access` is
  `public`. The old `release` script passed `--access public` by hand;
  semantic-release does not, so the field is now in `package.json`.
- semantic-release derives the current version from **git tags, not npm**. The
  repo had no tags while npm already had 0.0.1, so its first automated release
  would have been 1.0.0 — `v0.0.1` is now tagged at `0ec70eb` to anchor it.
- No commit before the automation used a conventional prefix, so a dry run
  reports "no relevant changes" and publishes nothing.
- CI runs Node 24 because the suite needs unflagged type stripping (22.18+),
  while the published CLI is plain JS and still meets the `>=20` engines floor.

## Repo conventions

- `CLAUDE.md` is a symlink to `AGENTS.md`, and it changed three times during one
  session — a snapshot taken at session start goes stale.
