import { Box, Text, useApp, useInput, useStdin, useWindowSize } from "ink";
import { useMemo, useState } from "react";
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseMember } from "../config.js";
import { transcriptFilename } from "../report.js";
import type { StoredSession } from "../sessions.js";
import { latestSession, listSessions, loadSession, relativeTime, sessionTitle } from "../sessions.js";
import { copyToClipboard } from "./clipboard.js";
import type { CommandSpec } from "./commands.js";
import { COMMANDS, completions, label, resolveCommand } from "./commands.js";
import { editInEditor } from "./editor.js";
import { mouseStartsOn, setMouseReporting } from "./mouse.js";
import { useConversation, useSession, useTabLines, useViewport } from "./hooks.js";
import { PromptInput } from "./prompt-input.js";
import type { Line, Tab } from "./lines.js";
import { turnTabs } from "./lines.js";
import type { PanelMember, Snapshot } from "./session.js";
import { ConsensusSession } from "./session.js";
import { truncate } from "./wrap.js";

type Overlay = "help" | "members" | "sessions" | "tabs" | "keys" | "queue" | null;

/** Lets the app force a full repaint after a child process used the terminal. */
export interface AppControl {
  repaint(): void;
}

/**
 * Lines to scroll for a chunk of SGR mouse reports, negative for up.
 *
 * Ink has no mouse support, so wheel reports arrive as ordinary input — and
 * with the leading ESC already consumed, which is why it is optional here.
 * Buttons 64 and 65 are wheel up and down; other buttons are clicks we ignore.
 */
function wheelDelta(input: string): number {
  let delta = 0;
  for (const event of input.matchAll(/\u001B?\[<(\d+);\d+;\d+[Mm]/g)) {
    const button = Number(event[1]);
    if (button === 64) delta -= 3;
    else if (button === 65) delta += 3;
  }
  return delta;
}

/** Human-readable name for a key event, for the /keys diagnostic. */
function describeKey(input: string, key: Record<string, unknown>): string {
  const mods = (["ctrl", "shift", "meta", "super", "hyper"] as const)
    .filter((name) => key[name])
    .join("+");

  const named = (
    [
      "return",
      "escape",
      "tab",
      "backspace",
      "delete",
      "upArrow",
      "downArrow",
      "leftArrow",
      "rightArrow",
      "pageUp",
      "pageDown",
      "home",
      "end",
    ] as const
  ).filter((name) => key[name]);

  const label = named.join(",") || (input ? JSON.stringify(input) : "(none)");
  return `${mods ? `${mods}+` : ""}${label}`;
}

export interface AppProps {
  session: ConsensusSession;
  cwd: string;
  control: AppControl;
}

export function App({ session, cwd, control }: AppProps) {
  const snapshot = useSession(session);
  const { exit } = useApp();
  const { stdin, setRawMode } = useStdin();
  const { columns, rows } = useWindowSize();

  const [draft, setDraft] = useState("");
  const [historyAt, setHistoryAt] = useState<number | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [detail, setDetail] = useState(false);
  const [follow, setFollow] = useState(true);
  const [scroll, setScroll] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [turnAt, setTurnAt] = useState(0);
  const [tabAt, setTabAt] = useState(0);
  const [tabScroll, setTabScroll] = useState(0);
  const [keyLog, setKeyLog] = useState<string[]>([]);
  const [matchAt, setMatchAt] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [mouse, setMouse] = useState(mouseStartsOn());

  /** Typing always revives completion that was dismissed with esc. */
  const updateDraft = (value: string) => {
    setDraft(value);
    setDismissed(false);
    setMatchAt(0);
  };

  // Prompt history is the session's own entries, so it survives a resume
  // instead of starting empty on every launch.
  const history = useMemo(
    () => [...snapshot.turns.map((turn) => turn.prompt), ...snapshot.queue],
    [snapshot.turns, snapshot.queue],
  );

  // Completion offers command names while a bare `/word` is being typed.
  const matches = useMemo(
    () => (dismissed || overlay ? [] : completions(draft)),
    [draft, dismissed, overlay],
  );
  const matchIndex = Math.min(matchAt, Math.max(0, matches.length - 1));
  const completionRows = Math.min(matches.length, 6);

  const width = Math.max(20, columns - 2);
  const paneHeight = Math.max(3, rows - 5 - completionRows);
  const lines = useConversation(snapshot, width, detail);
  const viewport = useViewport(lines, paneHeight, scroll, follow);

  // Tab browser: one turn at a time, merged answer plus each member's own.
  const turnIndex = Math.min(turnAt, Math.max(0, snapshot.turns.length - 1));
  const shownTurn = snapshot.turns[turnIndex];
  const tabs = useMemo(() => (shownTurn ? turnTabs(shownTurn) : []), [shownTurn]);
  const tabIndex = Math.min(tabAt, Math.max(0, tabs.length - 1));
  const activeTab = tabs[tabIndex];
  const tabBody = useTabLines(activeTab?.body ?? "", width, activeTab?.consensus ?? false);
  const tabPaneHeight = Math.max(1, paneHeight - 2);
  const tabViewport = useViewport(tabBody, tabPaneHeight, tabScroll, false);

  const save = (path?: string) => {
    if (snapshot.turns.length === 0) {
      setFlash("nothing to save yet");
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const file = path ?? transcriptFilename(snapshot.turns[0]!.prompt, stamp);
    writeFileSync(file, session.toMarkdown(), "utf8");
    setFlash(`saved ${file}`);
  };

  /**
   * Hand the terminal to $EDITOR, then load whatever was saved into the draft.
   * Deliberately does not auto-submit: an accidental save would otherwise fire
   * a full panel run.
   */
  const compose = async () => {
    try {
      const text = await editInEditor(draft, {
        release: () => {
          setRawMode(false);
          stdin.pause();
        },
        reclaim: () => {
          stdin.resume();
          setRawMode(true);
          control.repaint();
        },
      });
      setDraft(text);
      setFlash(
        !text
          ? "editor returned nothing"
          : text === draft.trim()
            ? "editor made no changes"
            : "loaded from editor — enter to send",
      );
    } catch (err) {
      setFlash(`editor failed: ${(err as Error).message}`);
    }
  };

  const resume = (target: StoredSession) => {
    session.persist();
    session.restore(target);
    setOverlay(null);
    setFollow(true);
    setFlash(`resumed ${target.id.slice(-4)} · ${target.turns.length} turns`);
  };

  const command = (text: string) => {
    const [typed, ...rest] = text.slice(1).split(/\s+/);
    // `/ses` resolves to /sessions; `/se` is ambiguous and falls through to the
    // unknown-command message rather than guessing.
    const name = resolveCommand(typed ?? "")?.name ?? typed;
    switch (name) {
      case "help":
        setOverlay("help");
        return;
      case "mouse": {
        const next = !mouse;
        setMouse(next);
        setMouseReporting(next);
        setFlash(
          next
            ? "wheel scrolling on — text selection is the terminal's again with /mouse off"
            : "wheel scrolling off — drag to select text; pgup/pgdn still scroll",
        );
        return;
      }
      case "keys":
        setKeyLog([]);
        setOverlay("keys");
        return;
      case "members":
      case "panel":
        setCursor(0);
        setOverlay("members");
        return;
      case "detail":
        setDetail((value) => !value);
        setFlash(detail ? "per-model responses hidden" : "per-model responses shown");
        return;
      case "edit":
        void compose();
        return;
      case "copy": {
        const answer = session.lastAnswer;
        if (!answer) {
          setFlash("no answer to copy yet");
          return;
        }
        copyToClipboard(answer).then(
          (tool) => setFlash(`copied ${answer.length} chars via ${tool}`),
          (err: Error) => setFlash(`copy failed: ${err.message}`),
        );
        return;
      }
      case "queue": {
        if (rest[0] === "clear") {
          const dropped = session.clearQueue();
          setFlash(dropped ? `dropped ${dropped} queued` : "queue was empty");
          return;
        }
        if (snapshot.queue.length === 0) {
          setFlash("queue is empty");
          return;
        }
        setOverlay("queue");
        return;
      }
      case "synth": {
        if (!rest[0]) {
          setFlash(`synthesizer is ${snapshot.synthesizer} — /synth <provider[:model]>`);
          return;
        }
        try {
          session.setSynthesizerMember(parseMember(rest.join(" ")));
          setFlash(`synthesizer is now ${rest.join(" ")}`);
        } catch (err) {
          setFlash((err as Error).message);
        }
        return;
      }
      case "add": {
        if (!rest[0]) {
          setFlash("usage: /add <provider[:model]>");
          return;
        }
        try {
          const member = parseMember(rest.join(" "));
          setFlash(
            session.addPanelMember(member)
              ? `added ${rest.join(" ")}`
              : `${rest.join(" ")} is already in the panel`,
          );
        } catch (err) {
          setFlash((err as Error).message);
        }
        return;
      }
      case "drop": {
        if (!rest[0]) {
          setFlash("usage: /drop <provider[:model]>");
          return;
        }
        setFlash(
          session.dropPanelMember(rest.join(" "))
            ? `dropped ${rest.join(" ")}`
            : `could not drop ${rest.join(" ")}`,
        );
        return;
      }
      case "rename": {
        if (!rest[0]) {
          setFlash("usage: /rename <title>");
          return;
        }
        session.setTitle(rest.join(" "));
        setFlash(`session renamed to ${rest.join(" ")}`);
        return;
      }
      case "sessions": {
        if (snapshot.busy) {
          setFlash("cannot switch sessions while running");
          return;
        }
        const found = listSessions().filter((entry) => entry.id !== snapshot.id);
        if (found.length === 0) {
          setFlash("no other saved sessions yet");
          return;
        }
        setSessions(found);
        setCursor(0);
        setOverlay("sessions");
        return;
      }
      case "resume": {
        if (snapshot.busy) {
          setFlash("cannot switch sessions while running");
          return;
        }
        const target = rest[0] ? loadSession(rest[0]) : latestSession();
        if (!target) {
          setFlash(rest[0] ? `no session matching ${rest[0]}` : "no saved sessions yet");
          return;
        }
        resume(target);
        return;
      }
      case "new":
        if (snapshot.busy) setFlash("cannot start a new session while running");
        else {
          session.reset();
          setFollow(true);
          setFlash("started a new session");
        }
        return;
      case "retry":
      case "again": {
        const previous = session.lastPrompt;
        if (previous) {
          setFollow(true);
          session.submit(previous);
        } else setFlash("nothing to retry");
        return;
      }
      case "save":
        save(rest.join(" ") || undefined);
        return;
      case "timeout": {
        const seconds = Number(rest[0]);
        if (!Number.isFinite(seconds) || seconds <= 0) {
          setFlash(`time limit is ${Math.round(snapshot.timeoutMs / 1000)}s — /timeout <seconds> to change`);
          return;
        }
        session.setTimeLimit(seconds * 1000);
        setFlash(`time limit now ${seconds}s (applies to the next turn)`);
        return;
      }
      case "stop":
        session.stop();
        return;
      case "quit":
      case "exit":
        session.stop();
        exit();
        return;
      default:
        setFlash(`unknown command /${name} — try /help`);
    }
  };

  const submit = (raw: string) => {
    const text = raw.trim();
    if (!text) return;

    setDraft("");
    setHistoryAt(null);
    setFlash(null);

    if (text.startsWith("/")) {
      command(text);
      return;
    }
    setFollow(true);
    session.submit(text);
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      session.stop();
      exit();
      return;
    }

    // Diagnostic: report what the terminal actually delivered, so an
    // unsupported chord (shift+enter on a legacy terminal) is visible rather
    // than mysterious. ctrl-x leaves, since every other key is under test.
    if (overlay === "keys") {
      if (key.ctrl && input === "x") {
        setOverlay(null);
        return;
      }
      setKeyLog((entries) => [...entries.slice(-14), describeKey(input, key as never)]);
      return;
    }

    // Wheel scrolls whatever pane is showing, before any key handling.
    const wheel = wheelDelta(input);
    if (wheel !== 0) {
      if (overlay === "tabs") {
        setTabScroll((value) => Math.min(tabViewport.maxOffset, Math.max(0, value + wheel)));
      } else if (overlay === null) {
        const next = Math.min(viewport.maxOffset, Math.max(0, viewport.offset + wheel));
        setFollow(next >= viewport.maxOffset);
        setScroll(next);
      }
      return;
    }

    if (overlay === "queue") {
      if (input === "c") {
        const dropped = session.clearQueue();
        setFlash(dropped ? `dropped ${dropped} queued` : "queue was empty");
        setOverlay(null);
      } else if (key.escape || key.return) setOverlay(null);
      return;
    }

    if (overlay === "help") {
      setOverlay(null);
      return;
    }

    if (overlay === "tabs") {
      if (key.escape || (key.ctrl && input === "t") || input === "q") setOverlay(null);
      else if (key.leftArrow || (key.tab && key.shift)) {
        setTabAt((t) => (tabs.length ? (t - 1 + tabs.length) % tabs.length : 0));
        setTabScroll(0);
      } else if (key.rightArrow || key.tab) {
        setTabAt((t) => (tabs.length ? (t + 1) % tabs.length : 0));
        setTabScroll(0);
      } else if (input === "[") {
        setTurnAt(Math.max(0, turnIndex - 1));
        setTabAt(0);
        setTabScroll(0);
      } else if (input === "]") {
        setTurnAt(Math.min(snapshot.turns.length - 1, turnIndex + 1));
        setTabAt(0);
        setTabScroll(0);
      } else if (input >= "1" && input <= "9") {
        const index = Number(input) - 1;
        if (index < tabs.length) {
          setTabAt(index);
          setTabScroll(0);
        }
      } else if (key.upArrow) setTabScroll((s) => Math.max(0, s - 1));
      else if (key.downArrow) setTabScroll((s) => Math.min(tabViewport.maxOffset, s + 1));
      else if (key.pageUp) setTabScroll((s) => Math.max(0, s - tabPaneHeight));
      else if (key.pageDown) setTabScroll((s) => Math.min(tabViewport.maxOffset, s + tabPaneHeight));
      else if (input === "g") setTabScroll(0);
      else if (input === "G") setTabScroll(tabViewport.maxOffset);
      return;
    }

    if (overlay === "sessions") {
      if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
      else if (key.downArrow) setCursor((c) => Math.min(sessions.length - 1, c + 1));
      else if (key.return) {
        const target = sessions[cursor];
        if (target) resume(target);
      } else if (key.escape) setOverlay(null);
      return;
    }

    if (overlay === "members") {
      if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
      else if (key.downArrow) setCursor((c) => Math.min(snapshot.panel.length - 1, c + 1));
      else if (input === " ") session.togglePanelMember(cursor);
      else if (input === "s") session.setSynthesizer(cursor);
      else if (key.return || key.escape) setOverlay(null);
      return;
    }

    // Completion owns enter, tab, the arrows and esc while the list is showing.
    if (matches.length > 0) {
      if (key.return) {
        const chosen = matches[matchIndex]!;
        // A required argument means there is nothing to run yet — complete the
        // name and wait for it. Anything else is runnable as it stands.
        if (chosen.args?.startsWith("<")) updateDraft(`/${chosen.name} `);
        else submit(`/${chosen.name}`);
        return;
      }
      if (key.tab) {
        const chosen = matches[matchIndex]!;
        updateDraft(`/${chosen.name}${chosen.args ? " " : ""}`);
        return;
      }
      if (key.upArrow) {
        setMatchAt(Math.max(0, matchIndex - 1));
        return;
      }
      if (key.downArrow) {
        setMatchAt(Math.min(matches.length - 1, matchIndex + 1));
        return;
      }
      if (key.escape) {
        setDismissed(true);
        return;
      }
    }

    if (key.escape) {
      session.stop();
      setFlash("stopped");
      return;
    }

    if (key.ctrl && input === "r") {
      setDetail((value) => !value);
      return;
    }

    if (key.ctrl && input === "t") {
      const done = snapshot.turns.findLastIndex((turn) => turn.done);
      if (done < 0) {
        setFlash("no completed turn to browse yet");
        return;
      }
      setTurnAt(done);
      setTabAt(0);
      setTabScroll(0);
      setOverlay("tabs");
      return;
    }

    if (key.pageUp) {
      setFollow(false);
      setScroll(Math.max(0, viewport.offset - paneHeight));
      return;
    }
    if (key.pageDown) {
      const next = Math.min(viewport.maxOffset, viewport.offset + paneHeight);
      if (next >= viewport.maxOffset) setFollow(true);
      else {
        setFollow(false);
        setScroll(next);
      }
      return;
    }

    // Arrows walk the prompt history, the way a shell REPL does — unless the
    // draft has more than one line, where they move the cursor instead.
    if (draft.includes("\n")) return;

    if (key.upArrow && history.length > 0) {
      const next = historyAt === null ? history.length - 1 : Math.max(0, historyAt - 1);
      setHistoryAt(next);
      setDraft(history[next] ?? "");
      return;
    }
    if (key.downArrow && historyAt !== null) {
      const next = historyAt + 1;
      if (next >= history.length) {
        setHistoryAt(null);
        setDraft("");
      } else {
        setHistoryAt(next);
        setDraft(history[next] ?? "");
      }
    }
  });

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Header cwd={cwd} snapshot={snapshot} width={width} detail={detail} />

      {overlay === "help" ? (
        <HelpOverlay height={paneHeight} />
      ) : overlay === "keys" ? (
        <KeysOverlay log={keyLog} height={paneHeight} />
      ) : overlay === "queue" ? (
        <QueueOverlay queue={snapshot.queue} height={paneHeight} width={width} />
      ) : overlay === "tabs" ? (
        <TabsOverlay
          tabs={tabs}
          selected={tabIndex}
          turn={turnIndex + 1}
          turns={snapshot.turns.length}
          prompt={shownTurn?.prompt ?? ""}
          visible={tabViewport.visible}
          height={paneHeight}
          width={width}
        />
      ) : overlay === "sessions" ? (
        <SessionsOverlay sessions={sessions} cursor={cursor} height={paneHeight} width={width} />
      ) : overlay === "members" ? (
        <MembersOverlay
          panel={snapshot.panel}
          cursor={cursor}
          synthesizer={snapshot.synthesizer}
          height={paneHeight}
        />
      ) : (
        <Conversation viewport={viewport} height={paneHeight} snapshot={snapshot} />
      )}

      {matches.length > 0 ? (
        <CompletionList matches={matches} selected={matchIndex} rows={completionRows} />
      ) : null}

      <Divider width={width} />

      <Box flexShrink={0}>
        <Text color={snapshot.busy ? "yellow" : "cyan"}>❯ </Text>
        <PromptInput
          value={draft}
          onChange={updateDraft}
          onSubmit={submit}
          focus={overlay === null}
          suppressSubmit={matches.length > 0}
          width={Math.max(10, width - 2)}
          placeholder={snapshot.busy ? "type to queue the next prompt…" : "Ask the panel…"}
        />
      </Box>

      <Footer
        overlay={overlay}
        flash={flash}
        queue={snapshot.queue.length}
        busy={snapshot.busy}
        following={follow}
        offset={viewport.offset}
        shown={paneHeight}
        total={viewport.total}
      />
    </Box>
  );
}

function Header({
  cwd,
  snapshot,
  width,
  detail,
}: {
  cwd: string;
  snapshot: Snapshot;
  width: number;
  detail: boolean;
}) {
  const enabled = snapshot.panel.filter((m) => m.enabled).length;

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box>
        <Text bold color="cyan">
          consensus
        </Text>
        <Text dimColor> · {basename(cwd) || cwd}</Text>
        <Text dimColor>
          {" "}
          · {enabled}/{snapshot.panel.length} members → {truncate(snapshot.synthesizer, 24)}
        </Text>
        <Text dimColor> · {Math.round(snapshot.timeoutMs / 1000)}s cap</Text>
        {detail ? <Text dimColor> · detail</Text> : null}
      </Box>
      <Divider width={width} />
    </Box>
  );
}

function Divider({ width }: { width: number }) {
  return <Text dimColor>{"─".repeat(Math.max(1, width))}</Text>;
}

function Conversation({
  viewport,
  height,
  snapshot,
}: {
  viewport: ReturnType<typeof useViewport>;
  height: number;
  snapshot: Snapshot;
}) {
  if (snapshot.turns.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} height={height}>
        <Text dimColor>Ask anything — every member answers, then one merges the answers.</Text>
        <Text dimColor>Type /help for commands. Keep typing while a panel runs to queue up.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} height={height}>
      {viewport.visible.map((line, index) => (
        <LineText key={index} line={line} />
      ))}
    </Box>
  );
}

function MembersOverlay({
  panel,
  cursor,
  synthesizer,
  height,
}: {
  panel: PanelMember[];
  cursor: number;
  synthesizer: string;
  height: number;
}) {
  return (
    <Box flexDirection="column" flexGrow={1} height={height}>
      <Text dimColor>space toggles · s sets synthesizer · enter returns</Text>
      <Box marginTop={1} flexDirection="column">
        {panel.map((member, index) => (
          <Box key={member.key}>
            <Text color={index === cursor ? "cyan" : undefined}>
              {index === cursor ? "❯ " : "  "}
            </Text>
            <Text dimColor={!member.enabled}>
              {member.enabled ? "● " : "○ "}
              {member.label}
            </Text>
            {member.label === synthesizer ? <Text color="yellow"> ★ synthesizer</Text> : null}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** One conversation row: a single colour, or several when it carries spans. */
function LineText({ line }: { line: Line }) {
  if (line.spans) {
    return (
      <Text>
        {line.spans.map((span, index) => (
          <Text key={index} color={span.color} dimColor={span.dim}>
            {span.text}
          </Text>
        ))}
      </Text>
    );
  }
  return (
    <Text color={line.color} dimColor={line.dim} bold={line.bold}>
      {line.text || " "}
    </Text>
  );
}

function CompletionList({
  matches,
  selected,
  rows,
}: {
  matches: CommandSpec[];
  selected: number;
  rows: number;
}) {
  // Keep the highlighted entry on screen when the list is longer than the box.
  const start = Math.max(0, Math.min(selected - rows + 1, matches.length - rows));

  return (
    <Box flexDirection="column" flexShrink={0}>
      {matches.slice(start, start + rows).map((command, index) => {
        const active = start + index === selected;
        return (
          <Box key={command.name}>
            <Text color={active ? "cyan" : undefined} bold={active}>
              {active ? "❯ " : "  "}
              {label(command).padEnd(18)}
            </Text>
            <Text dimColor>{command.help}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function QueueOverlay({
  queue,
  height,
  width,
}: {
  queue: string[];
  height: number;
  width: number;
}) {
  return (
    <Box flexDirection="column" flexGrow={1} height={height}>
      <Text dimColor>c clears the queue · esc returns · the running turn is untouched</Text>
      <Box marginTop={1} flexDirection="column">
        {queue.length === 0 ? (
          <Text dimColor>(empty)</Text>
        ) : (
          queue.slice(0, Math.max(1, height - 2)).map((prompt, index) => (
            <Box key={index}>
              <Text dimColor>{`${index + 1}. `}</Text>
              <Text>{truncate(prompt, Math.max(10, width - 6))}</Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

function KeysOverlay({ log, height }: { log: string[]; height: number }) {
  return (
    <Box flexDirection="column" flexGrow={1} height={height}>
      <Text dimColor>
        Press any key to see what consensus receives. ctrl-x returns.
      </Text>
      <Text dimColor>
        For a newline, shift+return should read “shift+return”. If it reads plain
        “return”, your terminal cannot report it — use alt+return, ctrl-j, or a
        trailing backslash.
      </Text>
      <Box marginTop={1} flexDirection="column">
        {log.length === 0 ? (
          <Text dimColor>(waiting…)</Text>
        ) : (
          log.map((entry, index) => (
            <Text key={index} color={index === log.length - 1 ? "cyan" : undefined} dimColor={index !== log.length - 1}>
              {entry}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}

function TabsOverlay({
  tabs,
  selected,
  turn,
  turns,
  prompt,
  visible,
  height,
  width,
}: {
  tabs: Tab[];
  selected: number;
  turn: number;
  turns: number;
  prompt: string;
  visible: Line[];
  height: number;
  width: number;
}) {
  return (
    <Box flexDirection="column" flexGrow={1} height={height}>
      <Box>
        <Text dimColor>
          turn {turn}/{turns}{" "}
        </Text>
        <Text dimColor>{truncate(prompt, Math.max(10, width - 12))}</Text>
      </Box>
      <Box flexWrap="wrap">
        {tabs.map((tab, index) => (
          <Text
            key={tab.title}
            color={index === selected ? "cyan" : tab.failed ? "red" : undefined}
            dimColor={index !== selected && !tab.failed}
            bold={index === selected}
          >
            {index === selected ? `[${index + 1} ${tab.title}] ` : ` ${index + 1} ${tab.title}  `}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {visible.map((line, index) => (
          <LineText key={index} line={line} />
        ))}
      </Box>
    </Box>
  );
}

function SessionsOverlay({
  sessions,
  cursor,
  height,
  width,
}: {
  sessions: StoredSession[];
  cursor: number;
  height: number;
  width: number;
}) {
  const rows = Math.max(1, height - 2);
  const start = Math.max(0, Math.min(cursor - Math.floor(rows / 2), sessions.length - rows));

  return (
    <Box flexDirection="column" flexGrow={1} height={height}>
      <Text dimColor>↑↓ choose · enter resumes · esc cancels</Text>
      <Box marginTop={1} flexDirection="column">
        {sessions.slice(start, start + rows).map((entry, index) => {
          const selected = start + index === cursor;
          return (
            <Box key={entry.id}>
              <Text color={selected ? "cyan" : undefined}>{selected ? "❯ " : "  "}</Text>
              <Text color={selected ? "cyan" : undefined}>{entry.id.slice(-4)} </Text>
              <Text dimColor>
                {`${relativeTime(entry.updatedAt)} · ${entry.turns.length}t `.padEnd(18)}
              </Text>
              <Text dimColor={!selected}>{truncate(sessionTitle(entry), Math.max(10, width - 30))}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function HelpOverlay({ height }: { height: number }) {
  const rows: Array<[string, string]> = [
    ["enter", "send — or queue, if the panel is busy"],
    ["shift-enter", "newline (needs a kitty-protocol terminal)"],
    ["alt-enter / ctrl-j", "newline — works everywhere"],
    ["trailing \\", "newline — works everywhere"],
    ["↑ ↓", "walk this session's earlier prompts"],
    ["pgup pgdn", "scroll the conversation (wheel too, after /mouse)"],
    ["esc", "stop the run and drop the queue"],
    ["ctrl-t", "browse a turn's tabs: ←→ tabs, ↑↓ scroll, [ ] turns, esc back"],
    ["ctrl-r", "toggle per-model responses inline"],
    ["ctrl-c", "quit"],
    ...COMMANDS.map((command): [string, string] => [label(command), command.help]),
  ];

  return (
    <Box flexDirection="column" flexGrow={1} height={height}>
      {rows.map(([key, description]) => (
        <Box key={key}>
          <Text color="cyan">{key.padEnd(14)}</Text>
          <Text dimColor>{description}</Text>
        </Box>
      ))}
      <Text dimColor>{"\n"}any key returns</Text>
    </Box>
  );
}

function Footer({
  overlay,
  flash,
  queue,
  busy,
  following,
  offset,
  shown,
  total,
}: {
  overlay: Overlay;
  flash: string | null;
  queue: number;
  busy: boolean;
  following: boolean;
  offset: number;
  shown: number;
  total: number;
}) {
  const hints =
    overlay === "help"
      ? "any key returns"
      : overlay === "queue"
        ? "c clears · esc returns"
        : overlay === "tabs"
        ? "←→ tabs · ↑↓ scroll · [ ] turns · 1-9 jump · esc back"
        : overlay === "sessions"
          ? "↑↓ choose · enter resumes · esc cancels"
          : overlay === "members"
        ? "space toggle · s synthesizer · enter done"
        : busy
          ? "enter queues · esc stops · ctrl-c quits"
          : "enter sends · /help · ctrl-r detail · ctrl-c quits";

  const right = [
    queue > 0 ? `${queue} queued` : "",
    total > shown ? (following ? "live" : `${offset + 1}-${Math.min(offset + shown, total)}/${total}`) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Box flexShrink={0} justifyContent="space-between">
      <Text dimColor>{flash ?? hints}</Text>
      <Text dimColor>{right}</Text>
    </Box>
  );
}
