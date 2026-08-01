import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface EditorHandover {
  /** Release the terminal back to a child process. */
  release(): void;
  /** Take the terminal back and force a full repaint. */
  reclaim(): void;
}

/**
 * Compose text in $EDITOR and return what was saved.
 *
 * The editor needs the real terminal, so the caller hands stdin over first —
 * two readers on one tty would fight over every keystroke. The child is spawned
 * asynchronously rather than with spawnSync so timers keep firing and any panel
 * still running is not frozen for the length of the edit.
 */
export async function editInEditor(initial: string, handover: EditorHandover): Promise<string> {
  const [command, ...args] = resolveEditor();
  const dir = mkdtempSync(join(tmpdir(), "consensus-"));
  const file = join(dir, "prompt.md");
  writeFileSync(file, initial, "utf8");

  handover.release();
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command!, [...args, file], { stdio: "inherit" });
      child.on("error", reject);
      child.on("close", () => resolve());
    });
  } finally {
    handover.reclaim();
  }

  try {
    return readFileSync(file, "utf8").trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Flags that make a GUI editor block until the file is closed. Without one,
 * the command returns the moment the window opens, we read back the unchanged
 * file, and the edit silently does nothing.
 */
const WAIT_FLAGS: Record<string, string> = {
  code: "--wait",
  "code-insiders": "--wait",
  codium: "--wait",
  cursor: "--wait",
  windsurf: "--wait",
  zed: "--wait",
  subl: "-w",
  sublime_text: "-w",
  mate: "-w",
  atom: "--wait",
};

/** $VISUAL, then $EDITOR, then vi — with a wait flag added when one is needed. */
export function resolveEditor(): string[] {
  const parts = (process.env.VISUAL || process.env.EDITOR || "vi").split(/\s+/).filter(Boolean);
  const name = parts[0]?.split("/").pop() ?? "vi";
  const wait = WAIT_FLAGS[name];

  if (wait && !parts.includes(wait)) parts.push(wait);
  return parts;
}
