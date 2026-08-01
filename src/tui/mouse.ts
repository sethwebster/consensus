/**
 * Wheel reporting, which the app must ask the terminal for.
 *
 * `1000` reports button presses (the wheel arrives as buttons 64/65) and `1006`
 * asks for SGR coordinates, unambiguous past column 223.
 *
 * This is off by default and deliberately so: while it is on, the terminal
 * hands mouse events to the app and stops doing click-drag text selection
 * itself. Losing selection to gain the wheel is a bad trade to impose, so the
 * wheel is opt-in — via CONSENSUS_MOUSE=1 or the /mouse toggle — and selection
 * works normally the rest of the time.
 */
const ON = "\u001B[?1000h\u001B[?1006h";
const OFF = "\u001B[?1006l\u001B[?1000l";

export function setMouseReporting(enabled: boolean): void {
  if (process.stdout.isTTY) process.stdout.write(enabled ? ON : OFF);
}

/** Whether the wheel starts enabled. */
export function mouseStartsOn(): boolean {
  return process.env.CONSENSUS_MOUSE === "1";
}
