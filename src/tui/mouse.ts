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

/** SGR mouse reports: `ESC [ < button ; col ; row M|m`. */
const SGR = /\u001B?\[<(\d+);\d+;\d+[Mm]/g;

/** Modifier bits (shift 4, alt 8, ctrl 16) layered onto the button byte. */
const MODIFIERS = 0b11100;

/**
 * Net scroll from every wheel tick in one read, in lines: negative is up.
 *
 * A single read can carry a burst of ticks, so they accumulate rather than
 * counting once. Modifier bits are masked off — the wheel has to keep working
 * while shift is held, since that is how text is selected with reporting on.
 */
export function wheelDelta(input: string): number {
  let delta = 0;
  for (const event of input.matchAll(SGR)) {
    const button = Number(event[1]) & ~MODIFIERS;
    if (button === 64) delta -= 3;
    else if (button === 65) delta += 3;
  }
  return delta;
}
