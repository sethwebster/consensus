import assert from "node:assert/strict";
import test from "node:test";
import { formatBytes, formatTokens, formatVolume } from "../dist/format.js";

test("formatBytes switches unit at each 1024 boundary", () => {
  assert.equal(formatBytes(0), "0B");
  assert.equal(formatBytes(1023), "1023B");
  assert.equal(formatBytes(1024), "1.0KB");
  assert.equal(formatBytes(1536), "1.5KB");
  assert.equal(formatBytes(1024 * 1024 - 1), "1024.0KB");
  assert.equal(formatBytes(1024 * 1024), "1.0MB");
});

test("formatTokens estimates ~4 chars per token and marks it approximate", () => {
  assert.equal(formatTokens(0), "~0t");
  assert.equal(formatTokens(400), "~100t");
  assert.equal(formatTokens(3996), "~999t");
  assert.equal(formatTokens(4000), "~1.0kt");
});

test("formatVolume is empty until there is something to report", () => {
  assert.equal(formatVolume(0), "");
  assert.equal(formatVolume(-1), "");
  assert.equal(formatVolume(2048), "2.0KB ~512t");
});
