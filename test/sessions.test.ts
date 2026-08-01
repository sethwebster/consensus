import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

const HOME = mkdtempSync(join(tmpdir(), "consensus-sessions-"));
process.env.CONSENSUS_HOME = HOME;

const { SESSIONS_DIR, latestSession, listSessions, loadSession, newSessionId, relativeTime, removeSession, saveSession, sessionTitle } =
  await import("../dist/sessions.js");
type StoredSession = Awaited<ReturnType<typeof loadSession>> & object;

after(() => rmSync(HOME, { recursive: true, force: true }));
beforeEach(() => rmSync(SESSIONS_DIR, { recursive: true, force: true }));

function session(id: string, updatedAt: string, turns: string[] = []): StoredSession {
  return {
    version: 1,
    id,
    createdAt: updatedAt,
    updatedAt,
    cwd: "/tmp",
    panel: [{ provider: "claude" }],
    synthesizer: { provider: "claude" },
    timeoutMs: 1000,
    turns: turns.map((prompt) => ({ prompt, members: [], synthesis: null, note: null })),
  } as StoredSession;
}

test("newSessionId is timestamp-prefixed, so ids sort chronologically", () => {
  const id = newSessionId(new Date("2026-07-31T20:07:13Z"));
  assert.match(id, /^20260731200713-[0-9a-f]{4}$/);
  assert.ok(newSessionId(new Date("2026-01-01T00:00:00Z")) < id);
});

test("newSessionId does not collide within the same second", () => {
  const at = new Date("2026-07-31T20:07:13Z");
  const ids = new Set(Array.from({ length: 50 }, () => newSessionId(at)));
  assert.ok(ids.size > 45, `expected mostly-unique ids, got ${ids.size}/50`);
});

test("listSessions is empty before anything is saved", () => {
  assert.deepEqual(listSessions(), []);
});

test("listSessions returns the newest first", () => {
  saveSession(session("a", "2026-07-01T00:00:00Z"));
  saveSession(session("b", "2026-07-31T00:00:00Z"));
  assert.deepEqual(listSessions().map((s) => s.id), ["b", "a"]);
});

test("listSessions skips an unreadable file rather than failing the listing", () => {
  saveSession(session("good", "2026-07-31T00:00:00Z"));
  writeFileSync(join(SESSIONS_DIR, "broken.json"), "{ not json", "utf8");
  assert.deepEqual(listSessions().map((s) => s.id), ["good"]);
});

test("loadSession resolves an exact id or a unique prefix, like a short hash", () => {
  saveSession(session("20260731-aaaa", "2026-07-31T00:00:00Z"));
  assert.equal(loadSession("20260731-aaaa")?.id, "20260731-aaaa");
  assert.equal(loadSession("20260731-a")?.id, "20260731-aaaa");
  assert.equal(loadSession("nope"), null);
});

test("latestSession is the most recently updated one", () => {
  saveSession(session("old", "2026-07-01T00:00:00Z"));
  saveSession(session("new", "2026-07-31T00:00:00Z"));
  assert.equal(latestSession()?.id, "new");
  rmSync(SESSIONS_DIR, { recursive: true, force: true });
  assert.equal(latestSession(), null);
});

test("removeSession deletes by prefix and reports the full id it removed", () => {
  saveSession(session("20260731-aaaa", "2026-07-31T00:00:00Z"));
  assert.equal(removeSession("20260731-a"), "20260731-aaaa");
  assert.deepEqual(listSessions(), []);
  assert.equal(removeSession("gone"), null);
});

test("sessionTitle prefers an explicit title, then the first prompt", () => {
  const stored = session("a", "2026-07-31T00:00:00Z", ["why is  the sky\nblue?"]);
  assert.equal(sessionTitle(stored), "why is the sky blue?");
  assert.equal(sessionTitle({ ...stored, title: "  sky colours  " }), "sky colours");
  assert.equal(sessionTitle(session("a", "2026-07-31T00:00:00Z")), "(empty)");
});

test("relativeTime rounds to the largest useful unit", () => {
  const now = new Date("2026-07-31T12:00:00Z").getTime();
  const ago = (ms: number) => relativeTime(new Date(now - ms).toISOString(), now);

  assert.equal(ago(0), "just now");
  assert.equal(ago(20_000), "just now");
  assert.equal(ago(5 * 60_000), "5m ago");
  assert.equal(ago(3 * 3_600_000), "3h ago");
  assert.equal(ago(2 * 86_400_000), "2d ago");
});

test("relativeTime treats a future timestamp as now, never as negative", () => {
  const now = Date.now();
  assert.equal(relativeTime(new Date(now + 60_000).toISOString(), now), "just now");
});
