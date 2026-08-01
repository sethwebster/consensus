import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { resolveEditor } from "../dist/tui/editor.js";

const original = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR };

afterEach(() => {
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function withEditor(visual: string | undefined, editor: string | undefined): string[] {
  if (visual === undefined) delete process.env.VISUAL;
  else process.env.VISUAL = visual;
  if (editor === undefined) delete process.env.EDITOR;
  else process.env.EDITOR = editor;
  return resolveEditor();
}

test("resolveEditor prefers $VISUAL, then $EDITOR, then vi", () => {
  assert.deepEqual(withEditor("nano", "vim"), ["nano"]);
  assert.deepEqual(withEditor(undefined, "vim"), ["vim"]);
  assert.deepEqual(withEditor(undefined, undefined), ["vi"]);
  assert.deepEqual(withEditor("", ""), ["vi"]);
});

test("resolveEditor keeps the flags the user already set", () => {
  assert.deepEqual(withEditor("emacs -nw", undefined), ["emacs", "-nw"]);
});

test("resolveEditor adds the wait flag a GUI editor needs to block", () => {
  // Without it the command returns as the window opens, the unchanged file is
  // read back, and the edit silently does nothing.
  assert.deepEqual(withEditor("code", undefined), ["code", "--wait"]);
  assert.deepEqual(withEditor("subl", undefined), ["subl", "-w"]);
});

test("resolveEditor recognises a GUI editor given by full path", () => {
  assert.deepEqual(withEditor("/usr/local/bin/code", undefined), ["/usr/local/bin/code", "--wait"]);
});

test("resolveEditor does not add a wait flag that is already there", () => {
  assert.deepEqual(withEditor("code --wait", undefined), ["code", "--wait"]);
});

test("resolveEditor leaves a terminal editor alone", () => {
  assert.deepEqual(withEditor("vim", undefined), ["vim"]);
});
