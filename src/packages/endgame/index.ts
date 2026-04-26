import type { GameOutcome } from "@whot-rules/state";
import type { PlayerId } from "@protocol-core/event-types";

export type ResultSummary = {
  gameId: string;
  rulesHash: string;
  rosterHash: string;
  outcome: GameOutcome;
  finalStateHash: string;
  finalEventHash: string;
};

export function summariseOutcome(outcome: GameOutcome, names: Record<PlayerId, string>): string {
  switch (outcome.type) {
    case "WIN":
      return `${names[outcome.winner] ?? outcome.winner} wins!`;
    case "STALEMATE":
      return `Stalemate (${outcome.reason.toLowerCase().replaceAll("_", " ")})`;
    case "ABANDONED":
      return `Game abandoned (${outcome.reason.toLowerCase().replaceAll("_", " ")})`;
    case "DISPUTED":
      return `Disputed game`;
  }
}

export type LocalLeaderboardEntry = {
  gameId: string;
  endedAt: number;
  outcome: GameOutcome;
  players: Array<{ playerId: PlayerId; displayName: string; finalScore?: number }>;
};

const LB_KEY = "whot.local-leaderboard.v1";

export function loadLocalLeaderboard(): LocalLeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(LB_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalLeaderboardEntry(entry: LocalLeaderboardEntry): void {
  const existing = loadLocalLeaderboard();
  if (existing.some((e) => e.gameId === entry.gameId)) return;
  const updated = [entry, ...existing].slice(0, 100);
  localStorage.setItem(LB_KEY, JSON.stringify(updated));
}
