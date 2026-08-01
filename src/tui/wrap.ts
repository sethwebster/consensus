/**
 * Greedy word wrap to a fixed column width, preserving blank lines and hard
 * breaking words too long to fit. Wrapping here (rather than letting the
 * terminal do it) is what makes line-accurate scrolling possible.
 */
export function wrapLines(text: string, width: number): string[] {
  const max = Math.max(1, Math.floor(width));
  const lines: string[] = [];

  for (const paragraph of text.replace(/\t/g, "  ").split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of paragraph.split(" ")) {
      let rest = word;

      while (rest.length > max) {
        if (current) {
          lines.push(current);
          current = "";
        }
        lines.push(rest.slice(0, max));
        rest = rest.slice(max);
      }
      if (!rest) continue;

      if (!current) current = rest;
      else if (current.length + 1 + rest.length <= max) current += ` ${rest}`;
      else {
        lines.push(current);
        current = rest;
      }
    }
    lines.push(current);
  }

  return lines;
}

/** Cut a string to `width`, marking the loss with an ellipsis. */
export function truncate(text: string, width: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (width <= 1) return flat.slice(0, Math.max(0, width));
  return flat.length > width ? `${flat.slice(0, width - 1)}…` : flat;
}
