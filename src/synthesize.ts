import type { RunResult } from "./run.js";

export interface SynthesisInput {
  prompt: string;
  answers: RunResult[];
}

/**
 * Frame the panel's answers for the synthesizer. Responses are fenced and
 * labelled by position rather than by vendor so the merge is judged on
 * content, not on brand reputation.
 */
export function buildSynthesisPrompt({ prompt, answers }: SynthesisInput): string {
  const sections = answers
    .map((answer, index) => {
      const name = `Response ${String.fromCharCode(65 + index)}`;
      return `<response id="${name}">\n${answer.text}\n</response>`;
    })
    .join("\n\n");

  return `You are the synthesizer for a panel of independent AI assistants. Each was given the same request, with no knowledge of the others. Your job is to produce the single best answer to that request.

<original_request>
${prompt}
</original_request>

Here are the panel's ${answers.length} independent responses:

${sections}

Write the canonical answer to the original request.

Rules:
- Answer the original request directly. The reader wants the answer, not a report about the panel.
- Never mention the panel, the responses, or that multiple models were consulted. Do not write phrases like "Response A says" or "all models agree".
- Keep any claim that is well supported by the weight of the responses.
- For a claim only one response makes: drop it silently if it is bare assertion or plainly contradicted on the facts, but if it is specifically argued, carry it into the dissent section described below rather than into the answer.
- Where responses differ on substance, prefer the one with concrete reasoning, working code, or verifiable specifics over the one that is merely confident.
- Merge complementary detail: if one response has better structure and another has better specifics, use both.
- If a response contains a clear factual or logical error, silently omit it rather than correcting it in prose.
- Match the format the original request implies. If it asked for code, lead with code. If it asked a question, answer it.
- Do not pad. Shorter is better when the content is the same.

After the answer, add at most ONE of the following sections.

Use this when most responses agree but at least one argues a different position, and that argument is specific and reasoned rather than vague:

---
**Dissent** (Response X): state the minority position, the strongest reason given for it, and what evidence or test would settle it. One to three sentences.

Replace X with the id of the response that argued it — "Response C", or "Response B and Response D" when more than one did. Name them exactly as they are labelled above; the reader is shown which model it was.

Use this instead when there is no majority at all — the responses split without a clear weight of support:

---
**Unresolved:** name the disagreement and what would settle it. One or two sentences.

Include a dissent even when the majority is clearly right on balance. A specific, well-reasoned minority view is information the reader wants, and burying it is the main way a merged answer becomes worse than its sources.

Omit both sections when the responses differ only in wording or emphasis, when the minority view is bare assertion with no supporting reasoning, or when it is simply factually wrong. Never invent a dissent to fill the section.`;
}

/**
 * Swap the positional labels back for real model names.
 *
 * The panel is presented to the synthesizer anonymously so it weighs arguments
 * rather than reputations, but once it has decided, the reader wants to know
 * who dissented. Attribution happens here, after the judging.
 */
export function attributeSources(text: string, answers: RunResult[]): string {
  return text.replace(/Response ([A-Z])\b/g, (whole, letter: string) => {
    const index = letter.charCodeAt(0) - 65;
    return answers[index]?.label ?? whole;
  });
}

/** Compact one-line-per-member digest shown above the synthesis. */
export function summarize(answers: RunResult[]): string {
  const ok = answers.filter((a) => a.ok);
  const failed = answers.filter((a) => !a.ok);
  const parts = [`${ok.length}/${answers.length} responded`];
  if (failed.length) parts.push(`${failed.length} failed`);
  return parts.join(", ");
}
