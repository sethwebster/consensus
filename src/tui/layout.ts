export interface Segment {
  text: string;
  /** Absolute offset of this segment's first character within the value. */
  start: number;
}

/**
 * Break a prompt draft into display rows.
 *
 * Wrapping is done here rather than left to the terminal: the terminal breaks
 * mid-word and restarts at column zero, which loses the alignment under the
 * prompt marker and puts the cursor somewhere other than where the text is.
 * Every character is preserved exactly, so offsets still map to screen
 * positions.
 */
export function promptSegments(value: string, width: number): Segment[] {
  const max = Math.max(4, Math.floor(width));
  const segments: Segment[] = [];
  let lineStart = 0;

  for (const line of value.split("\n")) {
    let index = 0;

    if (line.length === 0) segments.push({ text: "", start: lineStart });

    while (index < line.length) {
      let end = Math.min(index + max, line.length);
      if (end < line.length) {
        // Prefer breaking after the last space that fits.
        const space = line.lastIndexOf(" ", end);
        if (space > index) end = space + 1;
      }
      segments.push({ text: line.slice(index, end), start: lineStart + index });
      index = end;
    }

    lineStart += line.length + 1;
  }

  return segments.length > 0 ? segments : [{ text: "", start: 0 }];
}

export interface PaneLayout {
  /** Rows left for the conversation pane. */
  paneHeight: number;
  /** Columns available for prompt text inside the bordered input box. */
  inputWidth: number;
  /** Rows the draft occupies once wrapped to inputWidth. */
  inputRows: number;
}

/**
 * Vertical budget for the screen. The prompt lives in its own bordered box
 * with inner padding instead of being wedged between a divider and the
 * footer, and the conversation pane shrinks as the draft grows so the header
 * is never pushed off-screen.
 *
 * Rows: header (2) + pane + completions + input border (2) + draft rows +
 * footer (1). Columns given to the draft: border (2) + padding (2) + the
 * "❯ " marker (2) come off the terminal width.
 */
export function paneLayout(input: {
  rows: number;
  columns: number;
  completionRows: number;
  draft: string;
}): PaneLayout {
  const inputWidth = Math.max(10, input.columns - 6);
  const inputRows = input.draft ? promptSegments(input.draft, inputWidth).length : 1;
  const paneHeight = Math.max(3, input.rows - 5 - input.completionRows - inputRows);
  return { paneHeight, inputWidth, inputRows };
}
