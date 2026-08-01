import assert from "node:assert/strict";
import test from "node:test";
import { inlinePrompt, joinPrompt, shouldReadStdin } from "../dist/prompt.js";

test("inlinePrompt joins the words and drops the bare stdin marker", () => {
  assert.equal(inlinePrompt(["critique", "this"]), "critique this");
  assert.equal(inlinePrompt(["-", "critique", "this"]), "critique this");
  assert.equal(inlinePrompt(["-"]), "");
  assert.equal(inlinePrompt([]), "");
});

test("inlinePrompt keeps a hyphen that is part of a word", () => {
  assert.equal(inlinePrompt(["well-known", "-", "case"]), "well-known case");
});

test("shouldReadStdin is false whenever nothing is piped in", () => {
  assert.equal(shouldReadStdin({ piped: false, explicit: true, marked: true, hasOtherSource: false }), false);
});

test("shouldReadStdin reads a pipe that is the only source of a prompt", () => {
  assert.equal(shouldReadStdin({ piped: true, explicit: false, marked: false, hasOtherSource: false }), true);
});

test("shouldReadStdin ignores a pipe when a prompt was given another way", () => {
  // Reading unconditionally wedges the CLI under CI runners and cron, which
  // hand it an open-but-idle stdin.
  assert.equal(shouldReadStdin({ piped: true, explicit: false, marked: false, hasOtherSource: true }), false);
});

test("shouldReadStdin reads alongside another source when asked with - or --stdin", () => {
  assert.equal(shouldReadStdin({ piped: true, explicit: true, marked: false, hasOtherSource: true }), true);
  assert.equal(shouldReadStdin({ piped: true, explicit: false, marked: true, hasOtherSource: true }), true);
});

test("joinPrompt keeps file, stdin, and inline order with a blank line between", () => {
  assert.equal(joinPrompt(["spec", "piped", "instruction"]), "spec\n\npiped\n\ninstruction");
});

test("joinPrompt drops empty pieces and trims the result", () => {
  assert.equal(joinPrompt(["  spec  ", "", undefined, "  ask  "]), "spec\n\nask");
  assert.equal(joinPrompt([undefined, "", "   "]), "");
});
