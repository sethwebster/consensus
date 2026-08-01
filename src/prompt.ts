/**
 * Assembling a prompt from its three possible sources — a file, piped stdin,
 * and inline words. Kept apart from the IO that reads them so the precedence
 * rules can be exercised without a terminal.
 */

/** Inline words joined, with the bare `-` stdin marker removed. */
export function inlinePrompt(positionals: string[]): string {
  return positionals.filter((word) => word !== "-").join(" ").trim();
}

export interface StdinDecision {
  /** stdin can actually carry a prompt (a pipe, file, or socket). */
  piped: boolean;
  /** The caller passed --stdin. */
  explicit: boolean;
  /** The caller passed a bare `-` among the words. */
  marked: boolean;
  /** A file or inline words already supplied a prompt. */
  hasOtherSource: boolean;
}

/**
 * Whether piped stdin joins the prompt.
 *
 * A pipe is only read when it is the sole source or the caller asked for it.
 * Reading it unconditionally wedges the CLI whenever it inherits an
 * open-but-idle stdin, as it does under CI runners and cron.
 */
export function shouldReadStdin({ piped, explicit, marked, hasOtherSource }: StdinDecision): boolean {
  return piped && (explicit || marked || !hasOtherSource);
}

/** Join the pieces in file → stdin → inline order, blank line between. */
export function joinPrompt(parts: Array<string | undefined>): string {
  return parts.map((part) => part?.trim()).filter(Boolean).join("\n\n").trim();
}
