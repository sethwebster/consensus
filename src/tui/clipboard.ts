import { spawn } from "node:child_process";
import { which } from "../providers.js";

interface Copier {
  bin: string;
  args: string[];
}

/** Clipboard tools by platform, first one installed wins. */
function copier(): Copier | null {
  const candidates: Copier[] =
    process.platform === "darwin"
      ? [{ bin: "pbcopy", args: [] }]
      : process.platform === "win32"
        ? [{ bin: "clip", args: [] }]
        : [
            { bin: "wl-copy", args: [] },
            { bin: "xclip", args: ["-selection", "clipboard"] },
            { bin: "xsel", args: ["--clipboard", "--input"] },
          ];

  return candidates.find((candidate) => which(candidate.bin)) ?? null;
}

/**
 * Put text on the system clipboard. Resolves with the tool used, or rejects
 * with what to install — never silently no-ops.
 */
export async function copyToClipboard(text: string): Promise<string> {
  const tool = copier();
  if (!tool) {
    throw new Error(
      process.platform === "linux"
        ? "no clipboard tool found — install wl-copy, xclip, or xsel"
        : "no clipboard tool found on PATH",
    );
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(tool.bin, tool.args, { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${tool.bin} exited with code ${code}`)),
    );
    child.stdin.end(text);
  });

  return tool.bin;
}
