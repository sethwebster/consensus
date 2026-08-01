# DIARY

Standing instructions to my future self. What to do — the facts behind these
live in [LEARNINGS.md](LEARNINGS.md); do not restate them here.

## Every session

1. **Read `CLAUDE.md` first, and again whenever the user mentions it.** Do not
   trust a copy from earlier in the session.
2. **Write the failing test before the code.** No exceptions, including for a
   one-line change. Run it, watch it fail, then make it pass.
3. **When a new test fails, suspect the test first.** Most failures so far were
   wrong expectations, not broken code. Read the actual output before touching
   `src/`.
4. **Run `npm test` before any push.** Never push red without asking first.

## Keeping the suite clean

5. One behaviour per test, named as the behaviour. Delete a test rather than let
   two cover the same ground.
6. Exercise a real subprocess for anything CLI-shaped — spawn `dist/cli.js` with
   a fake model CLI on `PATH` in a temp dir. Do not mock what can be run.
7. Point any test that touches config or sessions at a temp `CONSENSUS_HOME`
   and clean it up in `after()`.

## Maintaining these files

8. Append to `LEARNINGS.md` when something surprises you; add here only when the
   lesson changes how you should work.
9. Keep the two files disjoint: facts there, instructions here. Prune anything
   that stops being true.

Eat my shorts,
past you
