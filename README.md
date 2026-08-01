# consensus

Ask one prompt to every AI CLI on your machine at once, then have one of them merge the answers into a single canonical response.

Different models are wrong in different places. Asking several and reconciling the answers surfaces the claims they all support and exposes the ones only one model makes.

```
$ consensus "when should I choose a monorepo over polyrepo?"
asking 6 models…
  ✖ cursor-agent      1.0s Error: Authentication required. Please run 'agent login' first
  ✖ gemini            3.9s Error authenticating: IneligibleTierError: This client is no…
  ✔ ollama:gemma4:e4b 7.8s 1.4KB
  ✔ claude            9.5s 501B
  ✔ opencode         11.8s 340B
  ✔ codex            12.8s 260B
  ✔ synthesizing (claude) 5.9s 454B

4/6 responded, 2 failed

Choose a monorepo when projects share code, tooling, or dependencies and
frequently need atomic changes across boundaries — the coordination cost of
syncing versions across separate repos outweighs the cost of shared build
infrastructure. Stick with polyrepos when components have genuinely
independent ownership, release cycles, access control, or tech stacks.
```

## Install

```bash
npm install
npm run build
npm install -g .   # puts `consensus` on your PATH
```

## Setup

`consensus` finds the model CLIs already installed on your machine — it never
asks for API keys, and reuses whatever auth each CLI already has.

```bash
consensus detect      # show which CLIs were found
consensus init        # pick your panel and synthesizer
consensus init -y     # or just accept everything detected
```

Config lives at `~/.config/consensus/config.json` (override with `$CONSENSUS_HOME`):

```json
{
  "members": [
    { "provider": "claude" },
    { "provider": "codex" },
    { "provider": "ollama", "model": "qwen3:8b" }
  ],
  "synthesizer": { "provider": "claude" },
  "timeoutMs": 300000
}
```

Without a config, every detected CLI answers and the highest-preference one synthesizes.

## Supported CLIs

Autodetected on `PATH`. Nothing is bundled; each must be installed and logged in on its own.

| Provider | Binary | Notes |
| --- | --- | --- |
| Claude Code | `claude` | |
| Codex | `codex` | runs read-only, sandboxed |
| Gemini CLI | `gemini` | |
| Cursor Agent | `cursor-agent` | |
| opencode | `opencode` | |
| Amp | `amp` | |
| Factory Droid | `droid` | |
| Crush | `crush` | |
| Goose | `goose` | |
| Amazon Q | `q` | |
| llm | `llm` | Simon Willison's `llm` |
| Ollama | `ollama` | local; requires a model, e.g. `ollama:qwen3:8b` |

## REPL

```bash
consensus tui                 # interactive REPL
consensus tui "a prompt"      # ...starting a run immediately
consensus --tui "a prompt"    # same thing
```

A conversational loop: ask, read the merged answer, ask again. **You never have
to wait for your turn** — type while the panel is still working and enter queues
the prompt, to run the moment the current one finishes. Queue as many as you
like; they run in order.

Runs on the terminal's alternate screen, so your scrollback is untouched on exit.

```
consensus · my-project · 4/4 members → claude · 300s cap
────────────────────────────────────────────────────────────────────────────
❯ what are the tradeoffs of event sourcing?
  ✔ claude 10.8s 832B ~208t · ✔ codex 15.6s 414B ~104t · ✖ gemini 3.9s
  ✖ gemini — Error authenticating: IneligibleTierError…

The biggest tradeoff is that you gain history as a first-class asset
and pay for it with permanent complexity everywhere else…

❯ and for a small team?
  ⠹ claude 2.1s 1.4KB ~371t · ⠹ codex 2.1s 640B ~160t · · ollama:qwen3:8b 0.0s
────────────────────────────────────────────────────────────────────────────
❯ type to queue the next prompt…
enter queues · esc stops · ctrl-c quits                    2 queued · live
```

**Each model's name is its own progress bar.** The letters start grey and fade
toward green from left to right as that model's answer streams in, warming
through orange at the wavefront. A response has no knowable length, so the
sweep is asymptotic — quick at first, then ever slower, never quite reaching
the last letter until the model actually finishes and the whole name turns
green. Red means it failed.

So a glance says who is still thinking, who is nearly there, and who has
landed. Your prompt stays in the default foreground — it is your text, not a
status.

Each member's status shows elapsed time and how much it has returned so far,
climbing live — the clearest signal that a slow member is producing something
rather than hanging. Token counts are approximate (`~`), derived from length at
about 4 characters per token; the member CLIs emit only text on stdout, no usage
metadata. A member that fails shows its reason inline, so a timeout never looks
like an auth error.

| Key | Action |
| --- | --- |
| `enter` | send — or queue it, if the panel is busy |
| `↑ ↓` | walk this session's earlier prompts (survives a resume) |
| wheel / `pgup` `pgdn` | scroll the conversation (auto-follows the bottom otherwise) |
| `ctrl-t` | browse a turn's answers as tabs (see below) |
| `esc` | stop the running turn and drop the queue |
| `ctrl-r` | toggle per-model responses inline |
| `ctrl-c` | quit |

### Scrolling

The REPL runs on the terminal's **alternate screen** — the same thing `vim` and
`less` use, and what keeps your shell scrollback untouched when you quit. The
alternate screen has no scrollback of its own, so your terminal's scrollbar has
nothing to scroll: the conversation is scrolled inside the app instead.

Scroll with the wheel or `pgup` / `pgdn`. The view follows the bottom on its
own while output arrives, and returns to following once you scroll back down —
the footer reads `live` when it is following, and `12-30/94` when it is not.

**Wheel scrolling is on by default.** While it is on the terminal hands mouse
events to the app instead of doing click-drag selection itself — but every
modern terminal still selects with `shift` held (`fn` or `option` in
Terminal.app), so you keep both. If you would rather have plain click-drag
selection:

- `/mouse` toggles the wheel for the session — off to select and copy text
  without a modifier, on to scroll by wheel again.
- `CONSENSUS_MOUSE=0` starts with it off.

With the wheel off, wheel ticks do nothing (`pgup` / `pgdn` still scroll). That
is deliberate: the terminal's fallback for wheel input on the alternate screen
is to send arrow keys, which here would page through prompt history and rewrite
your draft — the app turns that mode off.

To get an answer out without selecting it at all, `/copy` puts the last one on
the clipboard and `/save` writes the whole conversation to markdown.

### Multi-line prompts

Plain `enter` sends. To add a newline instead:

| Key | Works in |
| --- | --- |
| `shift-enter` | terminals speaking the kitty keyboard protocol (Ghostty, kitty, WezTerm, recent iTerm2) |
| `alt-enter` | everywhere |
| `ctrl-j` | everywhere |
| trailing `\` then enter | everywhere — shell-style continuation |

`shift-enter` needs the kitty protocol because in a legacy terminal, enter sends
a carriage return whether or not shift is held — the app is never told. If
yours can't report it, the other three always work.

Pasting multi-line text keeps its line breaks rather than submitting on the
first newline.

**If `shift-enter` submits instead of adding a newline**, run `/keys` and press
it. If it reports `shift+return`, it works; if it reports plain `return`, your
terminal (or a wrapper such as tmux or a terminal-embedding editor) isn't
forwarding the modifier. `CONSENSUS_KITTY=1` forces the protocol on when
auto-negotiation is being swallowed; `CONSENSUS_KITTY=0` disables it.

The prompt ignores terminal capability reports rather than typing them. A
terminal answers probes on the input stream, and when a reply lands after the
negotiating library has stopped listening — easy to trigger through a
multiplexer or terminal-embedding editor — it would otherwise appear in the
prompt as literal text such as `[?0u`.

### Tab browser

`ctrl-t` opens the most recent completed turn as tabs — the merged answer plus
each member's own response, full-screen and scrollable. Use it when you want to
see exactly what one model said, rather than the inline `ctrl-r` view.

```
turn 2/3  what are the tradeoffs of event sourcing?
[1 consensus]  2 claude   3 codex   4 ollama:qwen3:8b
```

| Key | Action |
| --- | --- |
| `← →` / `tab` | switch tabs |
| `1`–`9` | jump to a tab |
| `↑ ↓` / `pgup` `pgdn` | scroll |
| `g` / `G` | top / bottom |
| `[` `]` | previous / next turn |
| `esc` / `ctrl-t` / `q` | back to the REPL |

Type `/` and the commands appear above the input, filtering as you type.
`↑↓` picks one, `tab` completes it, `esc` dismisses the list. A unique prefix
runs without completing — `/tim` is `/timeout` — while an ambiguous one like
`/d` is reported rather than guessed.

| Command | Action |
| --- | --- |
| `/help` | key and command reference |
| `/edit` | compose the prompt in `$EDITOR` |
| `/copy` | copy the last answer to the clipboard |
| `/queue [clear]` | see what is queued, or drop it |
| `/retry` | re-run the last prompt |
| `/members` | toggle members on/off, set the synthesizer |
| `/synth <spec>` | set the synthesizer, e.g. `/synth codex` |
| `/add <spec>` | add a member for this session |
| `/drop <spec>` | remove a member for this session |
| `/detail` | toggle per-model responses (same as `ctrl-r`) |
| `/sessions` | pick an earlier session to resume |
| `/resume [id]` | resume by id, or the most recent |
| `/rename <title>` | name this session |
| `/new` | start a fresh session |
| `/save [file]` | write the whole conversation to markdown |
| `/timeout [sec]` | show or change the per-member time limit |
| `/keys` | show what your terminal sends for a key |
| `/quit` | exit |

Panel changes made with `/members`, `/synth`, `/add`, and `/drop` apply to the
current session only — edit the config or re-run `consensus init` to make them
stick.

`/queue` drops pending prompts without touching the turn already running, which
`esc` does not: `esc` stops everything.

`/edit` opens `$VISUAL`, then `$EDITOR`, then `vi`. GUI editors get a wait flag
added automatically (`cursor` → `cursor --wait`, and likewise for `code`,
`zed`, `subl`, …) — without one the command returns as soon as the window opens
and the edit is silently lost. Text comes back into the draft rather than
sending straight away, so an accidental save can't fire a panel run.

## Usage

```bash
consensus "what are the tradeoffs of event sourcing?"

# choose the panel for one run
consensus -m claude -m codex -m ollama:qwen3:8b "review this design"

# pick who synthesizes
consensus -s codex "design a rate limiter"

# see every raw answer alongside the merged one
consensus --all "is this regex correct? /^[a-z]+$/"

# skip synthesis entirely
consensus --no-synth "brainstorm names"

# pipe input
cat spec.md | consensus                     # piped text is the whole prompt
cat spec.md | consensus - "critique this"   # piped text plus an instruction

# machine-readable, or saved
consensus --json "..." > answers.json
consensus -o answer.md "..."
```

### Options

| Flag | Meaning |
| --- | --- |
| `-m, --model <spec>` | Panel member for this run; repeatable. `provider` or `provider:model`. |
| `-s, --synth <spec>` | Synthesizer for this run. |
| `-f, --file <path>` | Read the prompt from a file. |
| `--stdin` / `-` | Include piped stdin alongside an inline prompt. |
| `-a, --all` | Also print each member's raw response. |
| `--no-synth` | Print the raw responses only. |
| `--json` | Machine-readable output on stdout. |
| `-o, --out <path>` | Write a full markdown transcript. |
| `-t, --timeout <sec>` | Per-member time limit (default 300s). |
| `--cwd <path>` | Directory the member CLIs run in (default: current). |

Because members run in your current directory, they pick up project context —
so `consensus "why is this test flaky?"` inside a repo works as you'd expect.

### Commands

| Command | Meaning |
| --- | --- |
| `ask` | Ask the panel. The default; the word is optional. |
| `tui [prompt]` | Full-screen interactive mode. |
| `init [-y]` | Choose the panel and synthesizer. `-y` accepts autodetection. |
| `detect` | Show which model CLIs are installed. |
| `config` | Print the active config and its path. |

## Sessions

Every REPL conversation is saved automatically — after each turn and on exit —
to `~/.config/consensus/sessions/<id>.json`. Nothing to opt into.

```bash
consensus sessions            # list them, newest first
consensus resume              # reopen the most recent
consensus resume 8f0c         # reopen by id (a unique prefix or suffix works)
consensus sessions rm 8f0c    # delete one
```

```
$ consensus sessions
  8f0c  2h ago   6t   how should we shard the events table?
  1a2b  1d ago   2t   what are the tradeoffs of event sourcing?

2 sessions · resume with `consensus resume <id>`
```

Inside the REPL, `/sessions` opens a picker (`↑↓` then enter), `/resume [id]`
jumps straight to one, and `/new` starts fresh. Resuming restores the
conversation, the panel it ran with, and the time limit — and `↑` walks that
session's prompts, so you can re-ask or edit an earlier question immediately.

A resumed session is a **record**, not a shared memory: see the note on turn
independence under Behavior notes.

## Dissent

The merged answer is majority-weighted, but a minority view that is *specifically
argued* is not thrown away — it is carried into a closing section instead:

```
Use a managed service.

With three people, the operational surface of self-hosting is a part-time job…

---
**Dissent:** The case for self-hosting is that a managed instance costs roughly
4–6x equivalent raw compute… Settle it by attempting the restore drill: if the
team can go from a cold VPS to a verified point-in-time restore in a day, self-
hosting is the cheaper choice.
```

A dissent appears even when the majority is clearly right on balance — burying a
well-reasoned objection is the main way a merged answer ends up worse than its
sources. When the responses split with no majority at all, the section is
`**Unresolved:**` instead. Neither appears when the responses differ only in
wording, or when the minority view is bare assertion with no reasoning behind it.
In the REPL both are tinted so they don't blend into the answer.

## Behavior notes

- **Members run in parallel.** Total time is the slowest member, not the sum.
- **Failures are surfaced, not hidden.** A member that errors, times out, or
  returns nothing is reported with its reason; the rest still synthesize.
  `consensus` exits non-zero only when every member fails or synthesis fails.
- **One response means no synthesis.** With a single successful answer there is
  nothing to reconcile, so it is printed directly.
- **stdin is only read when it is the sole prompt source**, or when you pass `-`
  / `--stdin`. Reading it unconditionally wedges the CLI under CI runners and
  cron, which hand it an open-but-idle stdin.
- **Progress goes to stderr, answers to stdout**, so `consensus ... > out.md`
  captures just the answer.
- **Members run in your working directory**, so some write their own state there
  (`.codegraph`, `.omo`, `.omx`, …). Use `--cwd` to send them elsewhere.
- **Turns are independent.** Each prompt is sent to the members on its own —
  no prior turns are included as context. A follow-up like "and for a small
  team?" will not know what came before, in a fresh or a resumed session alike.
  The REPL and its saved sessions are a workspace and a record; they are not
  conversational memory shared with the models. Restate what matters in the
  prompt, or use `↑` to edit an earlier one.
- **The time limit applies everywhere** — every member and the synthesis step,
  in both the CLI and the REPL. It comes from `timeoutMs` in the config or `-t`,
  the REPL shows it in the header as `300s cap`, and `/timeout <sec>` changes it
  for the current session (taking effect on the next turn, not one in flight).
  A member that exceeds it is killed and reported as `timed out after Ns`.

## Programmatic use

```ts
import { detect, runAll, buildSynthesisPrompt } from "@sethwebster/consensus";

const members = (await detect()).map((d) => ({ provider: d.provider.id }));
const answers = await runAll(members, "explain CRDTs", {
  cwd: process.cwd(),
  timeoutMs: 300_000,
});
```

## Agent skill

`consensus` ships an installable **[Agent Skill](https://docs.claude.com/en/docs/claude-code/skills)** so any
harness that supports the skill format — Claude Code, the Agent SDK, and others —
can reach for a cross-model second opinion on its own. The skill is just a
directory with a `SKILL.md`; installing it copies that directory into the
harness's skills folder.

```bash
consensus-skill               # → ~/.claude/skills/consensus   (personal)
consensus-skill --project     # → ./.claude/skills/consensus   (checked into a repo)
consensus-skill --dir <path>  # → <path>/consensus             (any harness's skills dir)
consensus-skill --force       # overwrite an existing install
consensus-skill --print       # print the bundled skill's source path
```

From a clone without a global install, `npm run skill:install -- --project` does
the same thing. The skill drives the `consensus` binary over the shell, so that
still has to be installed and on `PATH` — the installer reminds you if it isn't.

Once installed, the agent invokes consensus when a question is high-stakes,
contested, or worth cross-checking, runs it non-interactively (`consensus --json
"…"`), and reports the merged answer along with any dissent. The skill source
lives in [`skill/`](skill/SKILL.md) if you want to read or adapt it.

## License

MIT
