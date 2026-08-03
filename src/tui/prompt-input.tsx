import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { promptSegments } from "./layout.js";

export interface PromptInputProps {
  value: string;
  onChange(value: string): void;
  onSubmit(value: string): void;
  placeholder?: string;
  focus?: boolean;
  /** Columns available for text, so wrapping matches the visible field. */
  width: number;
  /**
   * Enter belongs to someone else — the completion menu, which runs the
   * highlighted command instead of submitting the half-typed text. Ink has no
   * way to stop a key reaching the next handler, so ownership is explicit.
   */
  suppressSubmit?: boolean;
}

/**
 * Multi-line prompt field.
 *
 * Plain enter submits. A newline is inserted by shift+enter, alt+enter, ctrl-j,
 * or a trailing backslash — four spellings because terminals disagree about
 * which modifiers they report. shift+enter only reaches the app when the
 * terminal speaks the kitty keyboard protocol (Ghostty, kitty, WezTerm, recent
 * iTerm2); everywhere else CR is CR no matter what is held down, so the other
 * three exist to cover those terminals.
 */
export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder = "",
  focus = true,
  suppressSubmit = false,
  width,
}: PromptInputProps) {
  const [offset, setOffset] = useState(value.length);
  // Derived rather than synced by an effect: the value can change underneath us
  // when history recall replaces the draft.
  const cursor = Math.min(offset, value.length);
  const multiline = value.includes("\n");

  const insert = (text: string, at = cursor) => {
    const next = value.slice(0, at) + text + value.slice(at);
    onChange(next);
    setOffset(at + text.length);
  };

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") return;

      // Newline, in every spelling a terminal might deliver.
      if (key.return && (key.shift || key.meta)) {
        insert("\n");
        return;
      }
      if (key.ctrl && input === "j") {
        insert("\n");
        return;
      }

      if (key.return) {
        if (suppressSubmit) return;

        // Shell-style continuation: works in every terminal, no modifiers.
        if (value.slice(0, cursor).endsWith("\\")) {
          const next = `${value.slice(0, cursor - 1)}\n${value.slice(cursor)}`;
          onChange(next);
          setOffset(cursor);
          return;
        }
        onSubmit(value);
        setOffset(0);
        return;
      }

      if (key.leftArrow) {
        setOffset(Math.max(0, cursor - 1));
        return;
      }
      if (key.rightArrow) {
        setOffset(Math.min(value.length, cursor + 1));
        return;
      }

      // Vertical movement belongs to the field only while it holds more than
      // one line; otherwise the REPL uses it to walk prompt history.
      if ((key.upArrow || key.downArrow) && multiline) {
        setOffset(verticalMove(value, cursor, key.upArrow ? -1 : 1));
        return;
      }
      if (key.upArrow || key.downArrow || key.tab) return;

      if (key.backspace || key.delete) {
        if (cursor === 0) return;
        onChange(value.slice(0, cursor - 1) + value.slice(cursor));
        setOffset(cursor - 1);
        return;
      }

      if (key.escape || key.pageUp || key.pageDown) return;
      if (key.ctrl || key.meta) return;
      if (!input) return;

      if (isTerminalReport(input)) return;

      // Pasted text arrives in one chunk; keep its line breaks.
      const text = sanitize(input.replace(/\r\n?/g, "\n"));
      if (!text) return;
      insert(text);
    },
    { isActive: focus },
  );

  const segments = promptSegments(value, width);
  const cursorSegment = Math.max(
    0,
    segments.findLastIndex((segment) => segment.start <= cursor),
  );
  const cursorColumn = Math.min(
    cursor - (segments[cursorSegment]?.start ?? 0),
    segments[cursorSegment]?.text.length ?? 0,
  );

  if (value.length === 0 && placeholder) {
    return (
      <Box>
        {focus ? <Text inverse>{placeholder.slice(0, 1)}</Text> : <Text dimColor>{placeholder.slice(0, 1)}</Text>}
        <Text dimColor>{placeholder.slice(1)}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {segments.map((segment, index) => (
        <Text key={index} wrap="truncate-end">
          {focus && index === cursorSegment ? (
            <>
              {segment.text.slice(0, cursorColumn)}
              <Text inverse>{segment.text[cursorColumn] ?? " "}</Text>
              {segment.text.slice(cursorColumn + 1)}
            </>
          ) : (
            segment.text || " "
          )}
        </Text>
      ))}
    </Box>
  );
}

/**
 * A terminal capability report that arrived as plain text.
 *
 * Ink consumes the leading ESC of an unrecognized CSI sequence and hands the
 * remainder on as ordinary input, so a late reply to a kitty-keyboard or
 * device-attributes probe shows up as literal text like `[?0u`. Reports are
 * delivered as one chunk, so matching the whole event keeps normal typing —
 * which arrives a character at a time — safe.
 */
function isTerminalReport(text: string): boolean {
  return (
    /^\u001B?\[[?>=][0-9;:]*[a-zA-Z]$/.test(text) ||
    /^\u001B?\[[0-9;:]+[a-zA-Z]$/.test(text)
  );
}

/**
 * Strip escape sequences and control characters before they reach the draft.
 *
 * Terminals answer capability probes (kitty keyboard flags, device attributes)
 * on the input stream. If such a reply lands after the negotiating library has
 * stopped listening — easily triggered by a multiplexer or terminal-embedding
 * editor adding latency — it arrives here as ordinary keystrokes and would
 * otherwise be typed into the prompt as literal garbage like `[?0u`.
 */
function sanitize(input: string): string {
  return (
    input
      // Mouse reports, whose ESC ink has usually already eaten
      .replace(/\u001B?\[<\d+;\d+;\d+[Mm]/g, "")
      // OSC ... BEL / ST
      .replace(/\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g, "")
      // DCS ... ST
      .replace(/\u001BP[\s\S]*?\u001B\\/g, "")
      // CSI ... final byte
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
      // SS2/SS3 and other two-byte escapes
      .replace(/\u001B[@-Z\\-_]/g, "")
      .replace(/\u001B./g, "")
      // Leftover control bytes, keeping tab and newline
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
  );
}

/** Map a flat offset onto a line and column. */
function locate(lines: string[], offset: number): { line: number; column: number } {
  let remaining = offset;
  for (let index = 0; index < lines.length; index++) {
    const length = lines[index]!.length;
    if (remaining <= length) return { line: index, column: remaining };
    remaining -= length + 1;
  }
  return { line: lines.length - 1, column: lines.at(-1)?.length ?? 0 };
}

/** Move the cursor one line up or down, holding the column where possible. */
function verticalMove(value: string, offset: number, direction: -1 | 1): number {
  const lines = value.split("\n");
  const { line, column } = locate(lines, offset);
  const target = line + direction;
  if (target < 0 || target >= lines.length) return offset;

  let start = 0;
  for (let index = 0; index < target; index++) start += lines[index]!.length + 1;
  return start + Math.min(column, lines[target]!.length);
}
