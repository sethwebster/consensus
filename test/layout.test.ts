import assert from "node:assert/strict";
import test from "node:test";
import { paneLayout, promptSegments } from "../dist/tui/layout.js";

test("paneLayout budgets header, bordered input box, and footer", () => {
  // 24 rows: 2 header + 18 pane + 3 bordered input + 1 footer.
  const layout = paneLayout({ rows: 24, columns: 80, completionRows: 0, draft: "" });
  assert.equal(layout.paneHeight, 18);
  // 80 columns minus border (2), padding (2), and the "❯ " marker (2).
  assert.equal(layout.inputWidth, 74);
  assert.equal(layout.inputRows, 1);
});

test("each extra prompt line takes a row from the conversation", () => {
  const layout = paneLayout({ rows: 24, columns: 80, completionRows: 0, draft: "one\ntwo\nthree" });
  assert.equal(layout.inputRows, 3);
  assert.equal(layout.paneHeight, 16);
});

test("completion rows also come out of the conversation pane", () => {
  const layout = paneLayout({ rows: 24, columns: 80, completionRows: 4, draft: "" });
  assert.equal(layout.paneHeight, 14);
});

test("floors keep a usable pane and input on a tiny terminal", () => {
  const layout = paneLayout({ rows: 6, columns: 12, completionRows: 0, draft: "" });
  assert.equal(layout.paneHeight, 3);
  assert.equal(layout.inputWidth, 10);
});

test("promptSegments wraps after the last space that fits", () => {
  assert.deepEqual(promptSegments("hello world", 6), [
    { text: "hello ", start: 0 },
    { text: "world", start: 6 },
  ]);
});

test("promptSegments keeps blank lines and absolute offsets across newlines", () => {
  assert.deepEqual(promptSegments("a\n\nb", 10), [
    { text: "a", start: 0 },
    { text: "", start: 2 },
    { text: "b", start: 3 },
  ]);
});

test("promptSegments always yields at least one row", () => {
  assert.deepEqual(promptSegments("", 10), [{ text: "", start: 0 }]);
});
