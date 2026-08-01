import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { ALT_SCROLL_OFF, ALT_SCROLL_ON, mouseStartsOn, wheelDelta } from "../dist/tui/mouse.js";

const original = process.env.CONSENSUS_MOUSE;
afterEach(() => {
  if (original === undefined) delete process.env.CONSENSUS_MOUSE;
  else process.env.CONSENSUS_MOUSE = original;
});

test("the wheel starts on unless CONSENSUS_MOUSE=0 opts out", () => {
  delete process.env.CONSENSUS_MOUSE;
  assert.equal(mouseStartsOn(), true);
  process.env.CONSENSUS_MOUSE = "1";
  assert.equal(mouseStartsOn(), true);
  process.env.CONSENSUS_MOUSE = "0";
  assert.equal(mouseStartsOn(), false);
});

test("alternate scroll off and on are distinct, restorable sequences", () => {
  assert.equal(ALT_SCROLL_OFF, "\u001B[?1007l");
  assert.equal(ALT_SCROLL_ON, "\u001B[?1007h");
});

test("wheelDelta scrolls up on button 64 and down on button 65", () => {
  assert.equal(wheelDelta("[<64;10;5M"), -3);
  assert.equal(wheelDelta("[<65;10;5M"), 3);
});

test("wheelDelta accumulates a burst of ticks arriving in one read", () => {
  assert.equal(wheelDelta("[<65;1;1M[<65;1;1M[<65;1;1M"), 9);
  assert.equal(wheelDelta("[<65;1;1M[<64;1;1M"), 0);
});

test("wheelDelta still scrolls when a modifier is held", () => {
  // shift adds 4, alt 8, ctrl 16 to the button byte; masking them keeps the
  // wheel usable while the user holds shift to select text.
  assert.equal(wheelDelta("[<68;1;1M"), -3);
  assert.equal(wheelDelta("[<69;1;1M"), 3);
  assert.equal(wheelDelta("[<81;1;1M"), 3);
});

test("wheelDelta ignores clicks, drags, and unrelated input", () => {
  assert.equal(wheelDelta("[<0;10;5M"), 0);
  assert.equal(wheelDelta("[<0;10;5m"), 0);
  assert.equal(wheelDelta("hello"), 0);
  assert.equal(wheelDelta(""), 0);
});
