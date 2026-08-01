import type { RunResult } from "./run.js";

export interface TranscriptInput {
  prompt: string;
  answers: RunResult[];
  synthesis: RunResult | null;
  synthesizedBy: string;
}

/** The body of one run, at a configurable heading depth. */
function section({ prompt, answers, synthesis, synthesizedBy }: TranscriptInput, depth: number): string {
  const h = (level: number) => "#".repeat(depth + level);
  const parts = [`${h(0)} Prompt\n\n${prompt}\n`];

  if (synthesis?.ok) {
    parts.push(`${h(0)} Consensus\n\n_Synthesized by ${synthesizedBy}_\n\n${synthesis.text}\n`);
  } else if (synthesis && !synthesis.ok) {
    parts.push(`${h(0)} Consensus\n\n_Synthesis failed — ${synthesis.error}_\n`);
  }

  parts.push(`${h(0)} Individual responses\n`);
  for (const answer of answers) {
    const status = answer.ok ? `${(answer.ms / 1000).toFixed(1)}s` : `failed — ${answer.error}`;
    parts.push(`${h(1)} ${answer.label}\n\n_${status}_\n\n${answer.ok ? answer.text : ""}\n`);
  }

  return parts.join("\n");
}

/** Render a single run as a self-contained markdown document. */
export function transcript(input: TranscriptInput): string {
  return `# consensus\n\n${section(input, 2)}`;
}

/** Render a whole REPL conversation as one markdown document. */
export function conversationMarkdown(turns: TranscriptInput[]): string {
  if (turns.length === 0) return "# consensus session\n\n_No turns yet._\n";

  const body = turns
    .map((turn, index) => `## Turn ${index + 1}\n\n${section(turn, 3)}`)
    .join("\n---\n\n");

  return `# consensus session\n\n${body}`;
}

/** Filesystem-safe, human-recognizable name for a saved transcript. */
export function transcriptFilename(prompt: string, stamp: string): string {
  const slug =
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "consensus";
  return `consensus-${slug}-${stamp}.md`;
}
