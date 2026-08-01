import { render } from "ink";
import { createElement } from "react";
import type { Config } from "../config.js";
import type { StoredSession } from "../sessions.js";
import { App } from "./app.js";
import { mouseStartsOn, setMouseReporting } from "./mouse.js";
import { ConsensusSession } from "./session.js";

const ALT_ENTER = "\u001B[?1049h";
const ALT_EXIT = "\u001B[?1049l";
const CLEAR = "\u001B[2J\u001B[H";

/** CONSENSUS_KITTY=1 forces the protocol on, 0 off; otherwise negotiate. */
function kittyMode(): "auto" | "enabled" | "disabled" {
  const setting = process.env.CONSENSUS_KITTY;
  if (setting === "1") return "enabled";
  if (setting === "0") return "disabled";
  return "auto";
}

/**
 * Run the full-screen interface. Uses the terminal's alternate screen so the
 * user's scrollback survives the session untouched.
 */
export async function startTui(
  config: Config,
  cwd: string,
  initialPrompt?: string,
  restore?: StoredSession,
): Promise<number> {
  const session = new ConsensusSession(config, cwd);
  if (restore) session.restore(restore);

  // Filled in once `render` returns; the app calls it after a child process
  // (an editor) has drawn over the screen and ink's frame diff is stale.
  const control = { repaint: () => {} };

  // Raw mode BEFORE anything can probe the terminal. A capability query's reply
  // arrives on stdin, and while the tty is still in cooked mode the terminal
  // echoes it to the screen as literal text like `[?0u`. Ink turns echo off
  // when it starts, but the probe can beat it; claiming raw mode first closes
  // that window. Ink manages raw mode from here and restores it on unmount.
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  // Enter the alternate screen and wipe it, so anything echoed before we got
  // here does not sit at the top of the session.
  process.stdout.write(`${ALT_ENTER}${CLEAR}`);
  if (mouseStartsOn()) setMouseReporting(true);

  const instance = render(createElement(App, { session, cwd, control }), {
    exitOnCtrlC: false,
    // shift+enter is only reportable under the kitty keyboard protocol. Auto
    // negotiation can be swallowed by a terminal wrapper, so allow forcing it.
    kittyKeyboard: { mode: kittyMode() },
  });

  control.repaint = () => instance.clear();

  if (initialPrompt) session.submit(initialPrompt);

  try {
    await instance.waitUntilExit();
  } finally {
    session.stop();
    session.persist();
    setMouseReporting(false);
    process.stdout.write(ALT_EXIT);
  }

  return 0;
}
