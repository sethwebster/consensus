import { useMemo, useSyncExternalStore } from "react";
import type { Line } from "./lines.js";
import { answerLines, conversationLines } from "./lines.js";
import type { ConsensusSession, Snapshot } from "./session.js";
import { wrapLines } from "./wrap.js";

/**
 * Subscribe to the session store. useSyncExternalStore keeps the subscription
 * effect out of the component tree — components only read snapshots.
 */
export function useSession(session: ConsensusSession): Snapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}

/** Wrap one tab's body, tinting dissent callouts when it is the merged answer. */
export function useTabLines(
  body: string,
  width: number,
  consensus: boolean,
): Line[] {
  return useMemo(
    () =>
      consensus
        ? answerLines(body, width)
        : wrapLines(body, width).map((text) => ({ text })),
    [body, width, consensus],
  );
}

export function useConversation(snapshot: Snapshot, width: number, detail: boolean): Line[] {
  return useMemo(
    () => conversationLines(snapshot.turns, width, detail),
    [snapshot, width, detail],
  );
}

export interface Viewport {
  visible: Line[];
  offset: number;
  maxOffset: number;
  total: number;
}

/**
 * Slice the conversation to what fits on screen. When `follow` is set the view
 * pins to the bottom, so streaming output stays visible without user input.
 */
export function useViewport(
  lines: Line[],
  height: number,
  scroll: number,
  follow: boolean,
): Viewport {
  const rows = Math.max(1, height);
  const maxOffset = Math.max(0, lines.length - rows);
  const offset = follow ? maxOffset : Math.min(Math.max(0, scroll), maxOffset);

  return {
    visible: lines.slice(offset, offset + rows),
    offset,
    maxOffset,
    total: lines.length,
  };
}
