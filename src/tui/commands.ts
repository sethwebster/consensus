export interface CommandSpec {
  name: string;
  /** Argument hint shown in help and completion, e.g. `<spec>`. */
  args?: string;
  help: string;
}

/**
 * Every slash command, in the order they are offered. One list drives both the
 * help screen and completion, so a new command can never appear in one and be
 * missing from the other.
 */
export const COMMANDS: CommandSpec[] = [
  { name: "help", help: "keys and commands" },
  { name: "edit", help: "compose the prompt in $EDITOR" },
  { name: "copy", help: "copy the last answer to the clipboard" },
  { name: "queue", args: "[clear]", help: "see or drop what is queued" },
  { name: "retry", help: "re-run the last prompt" },
  { name: "members", help: "toggle members, set the synthesizer" },
  { name: "synth", args: "<spec>", help: "set the synthesizer, e.g. /synth codex" },
  { name: "add", args: "<spec>", help: "add a member for this session" },
  { name: "drop", args: "<spec>", help: "remove a member for this session" },
  { name: "detail", help: "toggle per-model responses inline" },
  { name: "sessions", help: "pick an earlier session to resume" },
  { name: "resume", args: "[id]", help: "resume by id, or the most recent" },
  { name: "rename", args: "<title>", help: "name this session" },
  { name: "new", help: "start a fresh session" },
  { name: "save", args: "[file]", help: "write the conversation to markdown" },
  { name: "timeout", args: "[sec]", help: "show or change the per-member time limit" },
  { name: "mouse", help: "toggle wheel scrolling (off lets you select text)" },
  { name: "keys", help: "show what your terminal sends for a key" },
  { name: "stop", help: "stop the run and drop the queue" },
  { name: "quit", help: "exit" },
];

/** Commands whose prefix is still being typed, e.g. `/se` → sessions, save. */
export function completions(draft: string): CommandSpec[] {
  const match = /^\/([a-z]*)$/.exec(draft);
  if (!match) return [];
  const prefix = match[1]!;
  return COMMANDS.filter((command) => command.name.startsWith(prefix));
}

/**
 * Resolve a typed name to a command: exact match first, then a unique prefix,
 * so `/se` is ambiguous but `/ses` runs `/sessions`.
 */
export function resolveCommand(name: string): CommandSpec | null {
  const exact = COMMANDS.find((command) => command.name === name);
  if (exact) return exact;

  const partial = COMMANDS.filter((command) => command.name.startsWith(name));
  return partial.length === 1 ? partial[0]! : null;
}

export function label(command: CommandSpec): string {
  return `/${command.name}${command.args ? ` ${command.args}` : ""}`;
}
