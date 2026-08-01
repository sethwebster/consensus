import assert from "node:assert/strict";
import test from "node:test";
import { truncate, wrapLines } from "../dist/tui/wrap.js";

test("wrapLines breaks on words without exceeding the width", () => {
  const lines = wrapLines("the quick brown fox jumps", 11);
  assert.deepEqual(lines, ["the quick", "brown fox", "jumps"]);
  for (const line of lines) assert.ok(line.length <= 11);
});

test("wrapLines preserves blank lines so paragraphs survive", () => {
  assert.deepEqual(wrapLines("a\n\nb", 10), ["a", "", "b"]);
});

test("wrapLines hard-breaks a word longer than the width", () => {
  assert.deepEqual(wrapLines("aaaaaaa", 3), ["aaa", "aaa", "a"]);
});

test("wrapLines flushes the pending line before a hard break", () => {
  assert.deepEqual(wrapLines("hi aaaaaa", 3), ["hi", "aaa", "aaa"]);
});

test("wrapLines turns tabs into spaces, collapsing runs like any other gap", () => {
  assert.deepEqual(wrapLines("a\tb", 10), ["a b"]);
  assert.deepEqual(wrapLines("a   b", 10), ["a b"]);
});

test("wrapLines treats a width below 1 as 1 rather than looping forever", () => {
  assert.deepEqual(wrapLines("ab", 0), ["a", "b"]);
});

test("truncate collapses whitespace and marks the cut with an ellipsis", () => {
  assert.equal(truncate("a   b\nc", 20), "a b c");
  assert.equal(truncate("abcdef", 4), "abc…");
  assert.equal(truncate("abcd", 4), "abcd");
});

test("truncate has no room for an ellipsis at width 1 or less", () => {
  assert.equal(truncate("abc", 1), "a");
  assert.equal(truncate("abc", 0), "");
});
