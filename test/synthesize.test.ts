import assert from "node:assert/strict";
import test from "node:test";
import type { RunResult } from "../dist/run.js";
import { attributeSources, buildSynthesisPrompt, summarize } from "../dist/synthesize.js";

function answer(label: string, text: string, ok = true): RunResult {
  return { member: { provider: label }, label, ok, text, ms: 10 };
}

test("buildSynthesisPrompt labels responses by position, never by vendor", () => {
  const prompt = buildSynthesisPrompt({
    prompt: "why is the sky blue?",
    answers: [answer("claude", "rayleigh scattering"), answer("codex", "shorter wavelengths scatter")],
  });

  assert.match(prompt, /<response id="Response A">\nrayleigh scattering\n<\/response>/);
  assert.match(prompt, /<response id="Response B">\nshorter wavelengths scatter\n<\/response>/);
  assert.doesNotMatch(prompt, /claude|codex/);
});

test("buildSynthesisPrompt carries the original request and the panel size", () => {
  const prompt = buildSynthesisPrompt({ prompt: "why is the sky blue?", answers: [answer("claude", "x")] });
  assert.match(prompt, /<original_request>\nwhy is the sky blue\?\n<\/original_request>/);
  assert.match(prompt, /panel's 1 independent responses/);
});

test("attributeSources swaps positional labels back for model names", () => {
  const answers = [answer("claude", "a"), answer("ollama:qwen3", "b")];
  assert.equal(
    attributeSources("**Dissent** (Response B): it disagrees.", answers),
    "**Dissent** (ollama:qwen3): it disagrees.",
  );
});

test("attributeSources leaves a label with no matching response untouched", () => {
  assert.equal(attributeSources("Response Z said so", [answer("claude", "a")]), "Response Z said so");
});

test("attributeSources does not rewrite prose that merely starts with the word", () => {
  assert.equal(attributeSources("Responses vary", [answer("claude", "a")]), "Responses vary");
});

test("summarize counts responders, and names failures only when there are some", () => {
  assert.equal(summarize([answer("a", "x"), answer("b", "y")]), "2/2 responded");
  assert.equal(summarize([answer("a", "x"), answer("b", "", false)]), "1/2 responded, 1 failed");
  assert.equal(summarize([]), "0/0 responded");
});
