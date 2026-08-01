import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "./config.js";
import type { Member } from "./config.js";

export const SESSIONS_DIR = join(CONFIG_DIR, "sessions");

export interface StoredRun {
  label: string;
  status: "done" | "failed" | "skipped" | "pending" | "running";
  ms: number;
  bytes: number;
  text: string;
  error?: string;
}

export interface StoredTurn {
  prompt: string;
  members: StoredRun[];
  synthesis: (StoredRun & { label: string }) | null;
  note: string | null;
}

export interface StoredSession {
  version: 1;
  id: string;
  /** Set by /rename; otherwise the first prompt names the session. */
  title?: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  panel: Member[];
  synthesizer: Member;
  timeoutMs: number;
  turns: StoredTurn[];
}

/** Sortable, readable, collision-resistant enough for a local directory. */
export function newSessionId(date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}

export function saveSession(session: StoredSession): void {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  writeFileSync(
    join(SESSIONS_DIR, `${session.id}.json`),
    `${JSON.stringify(session, null, 2)}\n`,
    "utf8",
  );
}

/** Newest first. Unreadable files are skipped rather than failing the listing. */
export function listSessions(): StoredSession[] {
  let names: string[];
  try {
    names = readdirSync(SESSIONS_DIR).filter((name) => name.endsWith(".json"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const sessions: StoredSession[] = [];
  for (const name of names) {
    try {
      sessions.push(JSON.parse(readFileSync(join(SESSIONS_DIR, name), "utf8")) as StoredSession);
    } catch {
      continue;
    }
  }

  return sessions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** Resolve an exact id or a unique prefix of one, the way git short hashes work. */
export function loadSession(id: string): StoredSession | null {
  const all = listSessions();
  return all.find((s) => s.id === id) ?? all.find((s) => s.id.startsWith(id)) ?? null;
}

export function latestSession(): StoredSession | null {
  return listSessions()[0] ?? null;
}

export function removeSession(id: string): string | null {
  const session = loadSession(id);
  if (!session) return null;
  rmSync(join(SESSIONS_DIR, `${session.id}.json`), { force: true });
  return session.id;
}

/** An explicit title if one was set, else the first prompt. */
export function sessionTitle(session: StoredSession): string {
  const label = session.title?.trim() || session.turns[0]?.prompt || "(empty)";
  return label.replace(/\s+/g, " ").trim();
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
