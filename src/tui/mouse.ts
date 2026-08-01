/**
 * Wheel reporting, which the app must ask the terminal for.
 *
 * `1000` reports button presses (the wheel arrives as buttons 64/65) and `1006`
 * asks for SGR coordinates, unambiguous past column 223.
 *
 * On by default: without it, terminals with "alternate scroll" turn wheel
 * ticks into arrow keys, which walk prompt history here — a wheel spin would
 * rewrite the draft instead of scrolling. While reporting is on the terminal
 * stops doing click-drag selection itself, but every modern terminal selects
 * anyway with shift held (fn/option in Terminal.app), so little is lost.
 * /mouse or CONSENSUS_MOUSE=0 hands the mouse back for plain selection.
 */
const ON = "\u001B[?1000h\u001B[?1006h";
const OFF = "\u001B[?1006l\u001B[?1000l";

/**
 * Alternate scroll (mode 1007) is what turns wheel ticks into arrow keys on
 * the alternate screen while mouse reporting is off. Off for the whole
 * session, so /mouse off makes the wheel inert rather than history-walking.
 * Restored on exit to the near-universal terminal default, on.
 */
export const ALT_SCROLL_OFF = "\u001B[?1007l";
export const ALT_SCROLL_ON = "\u001B[?1007h";

export function setMouseReporting(enabled: boolean): void {
  if (process.stdout.isTTY) process.stdout.write(enabled ? ON : OFF);
}

/** Whether the wheel starts enabled: yes, unless CONSENSUS_MOUSE=0 opts out. */
export function mouseStartsOn(): boolean {
  return process.env.CONSENSUS_MOUSE !== "0";
}
