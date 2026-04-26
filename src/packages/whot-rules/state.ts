import type { PlayerId } from "@protocol-core/event-types";
import type { Card, Shape } from "./deck";
import type { WhotRulesConfig } from "./rules-config";

export type GameOutcome =
  | { type: "WIN"; winner: PlayerId; finalScores?: Record<PlayerId, number> }
  | {
      type: "STALEMATE";
      reason: "NO_MOVES" | "DRAW_PILE_EXHAUSTED" | "PROTOCOL_DEADLOCK";
      finalScores?: Record<PlayerId, number>;
    }
  | { type: "ABANDONED"; reason: "DISCONNECT" | "HOST_CLOSED" | "PLAYER_TIMEOUT" }
  | { type: "DISPUTED"; accusedPlayerIds: PlayerId[] };

export type WhotGameState = {
  phase: "SETUP" | "IN_PLAY" | "ENDED";
  rulesHash: string;
  rulesConfig: WhotRulesConfig;
  playerOrder: PlayerId[];
  currentPlayerIndex: number;
  direction: 1 | -1;
  hands: Record<PlayerId, Card[]>;
  drawPile: Card[];
  discardPile: Card[]; // top is last element
  calledShape?: Shape;
  pendingPenalty?: { type: "PICK_TWO" | "PICK_THREE"; count: number; sourcePlayer: PlayerId };
  lastCardDeclared: Record<PlayerId, boolean>;
  outcome?: GameOutcome;
  // Whether the player who just played a `holdOn`/`suspend` already had their
  // extra turn applied (so we don't loop).
  skipNext: number; // number of upcoming turns to skip
  reshuffleCount: number;
};

export function currentPlayer(state: WhotGameState): PlayerId {
  return state.playerOrder[state.currentPlayerIndex]!;
}

export function topDiscard(state: WhotGameState): Card | undefined {
  return state.discardPile[state.discardPile.length - 1];
}

export function activeMatchShape(state: WhotGameState): Shape | undefined {
  if (state.calledShape) return state.calledShape;
  const top = topDiscard(state);
  return top?.shape;
}
