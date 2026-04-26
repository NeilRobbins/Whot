import type { PlayerId } from "@protocol-core/event-types";
import type { Card, Shape } from "./deck";
import { hashCanonical } from "@protocol-core/hashing";
import type {
  GameInitialisedPayload,
  PlayCardPayload,
  DrawCardPayload,
  AcceptPenaltyPayload,
} from "./events";
import { getSpecial, isWhotCard, validatePlay } from "./validator";
import { currentPlayer, topDiscard, type WhotGameState } from "./state";

export type WhotEventInput =
  | { type: "GAME_INITIALISED"; actor: PlayerId; payload: GameInitialisedPayload }
  | { type: "PLAY_CARD"; actor: PlayerId; payload: PlayCardPayload }
  | { type: "DRAW_CARD"; actor: PlayerId; payload: DrawCardPayload }
  | { type: "DECLARE_LAST_CARD"; actor: PlayerId; payload: Record<string, never> }
  | { type: "ACCEPT_PENALTY"; actor: PlayerId; payload: AcceptPenaltyPayload };

export class RuleError extends Error {}

export function initialState(payload: GameInitialisedPayload): WhotGameState {
  return {
    phase: "IN_PLAY",
    rulesHash: payload.rulesHash,
    rulesConfig: payload.rulesConfig,
    playerOrder: payload.playerOrder,
    currentPlayerIndex: 0,
    direction: 1,
    hands: { ...payload.initialHands },
    drawPile: [...payload.initialDrawPile],
    discardPile: [payload.initialDiscard],
    lastCardDeclared: Object.fromEntries(payload.playerOrder.map((p) => [p, false])),
    skipNext: 0,
    reshuffleCount: 0,
  };
}

export function reduce(state: WhotGameState, event: WhotEventInput): WhotGameState {
  switch (event.type) {
    case "GAME_INITIALISED":
      throw new RuleError("GAME_INITIALISED must be applied via initialState");
    case "PLAY_CARD":
      return applyPlayCard(state, event.actor, event.payload);
    case "DRAW_CARD":
      return applyDraw(state, event.actor, event.payload);
    case "DECLARE_LAST_CARD":
      return applyDeclareLastCard(state, event.actor);
    case "ACCEPT_PENALTY":
      return applyAcceptPenalty(state, event.actor, event.payload);
  }
}

function clone(state: WhotGameState): WhotGameState {
  return {
    ...state,
    hands: Object.fromEntries(
      Object.entries(state.hands).map(([k, v]) => [k, v.slice()]),
    ),
    drawPile: state.drawPile.slice(),
    discardPile: state.discardPile.slice(),
    lastCardDeclared: { ...state.lastCardDeclared },
    pendingPenalty: state.pendingPenalty ? { ...state.pendingPenalty } : undefined,
  };
}

function advanceTurn(state: WhotGameState, by = 1): void {
  const n = state.playerOrder.length;
  state.currentPlayerIndex = (state.currentPlayerIndex + by * state.direction + n * 8) % n;
}

function reshuffleIfNeeded(state: WhotGameState): void {
  if (state.drawPile.length > 0) return;
  if (state.rulesConfig.emptyDrawPilePolicy !== "reshuffle_discard_except_top") return;
  if (state.discardPile.length <= 1) return;
  const top = state.discardPile[state.discardPile.length - 1]!;
  const rest = state.discardPile.slice(0, -1);
  // Deterministic re-order: reverse the discard, no re-randomisation.
  // This is acceptable in dealer-mode where the deck order is already
  // public via the seed — re-randomisation isn't required for fairness.
  state.drawPile = rest.reverse();
  state.discardPile = [top];
  state.reshuffleCount += 1;
}

function applyPlayCard(
  state: WhotGameState,
  player: PlayerId,
  payload: PlayCardPayload,
): WhotGameState {
  const v = validatePlay(state, player, payload.card, payload.calledShape);
  if (!v.ok) throw new RuleError(v.reason);

  const next = clone(state);
  const hand = next.hands[player]!;
  const idx = hand.findIndex((c) => c.id === payload.card.id);
  if (idx < 0) throw new RuleError("Card not in hand");
  hand.splice(idx, 1);

  const card = payload.card;
  next.discardPile.push(card);

  // Reset called shape; re-set if Whot.
  next.calledShape = undefined;
  if (isWhotCard(card)) {
    next.calledShape = payload.calledShape;
  }

  // Apply special card effects.
  const special = getSpecial(state, card);
  let extraAdvance = 1; // default: advance to next player
  switch (special) {
    case "HOLD_ON":
      extraAdvance = 0; // same player plays again
      break;
    case "SUSPEND":
      extraAdvance = 2; // skip next player
      break;
    case "PICK_TWO": {
      const stacked = next.pendingPenalty?.type === "PICK_TWO";
      next.pendingPenalty = {
        type: "PICK_TWO",
        count: (stacked ? next.pendingPenalty!.count : 0) + 2,
        sourcePlayer: player,
      };
      extraAdvance = 1;
      break;
    }
    case "PICK_THREE": {
      const stacked = next.pendingPenalty?.type === "PICK_THREE";
      next.pendingPenalty = {
        type: "PICK_THREE",
        count: (stacked ? next.pendingPenalty!.count : 0) + 3,
        sourcePlayer: player,
      };
      extraAdvance = 1;
      break;
    }
    case "GENERAL_MARKET": {
      // Every other player draws one (deterministically, top of pile).
      for (const pid of next.playerOrder) {
        if (pid === player) continue;
        reshuffleIfNeeded(next);
        const top = next.drawPile.shift();
        if (top) next.hands[pid]!.push(top);
      }
      extraAdvance = 1;
      break;
    }
    case "WHOT":
      extraAdvance = 1;
      break;
    default:
      extraAdvance = 1;
  }

  // Pending penalty cleared by playing it (above for PICK_TWO/THREE only stacks
  // the same type — others would have been blocked by the validator).

  // Win check — but only if no pending penalty applies to this player.
  const stillHasCards = hand.length > 0;
  if (!stillHasCards) {
    const declarationRequired = next.rulesConfig.lastCardDeclaration.required;
    if (declarationRequired && !next.lastCardDeclared[player]) {
      // Penalty: take penaltyCards back into hand.
      const k = next.rulesConfig.lastCardDeclaration.penaltyCards;
      for (let i = 0; i < k; i++) {
        reshuffleIfNeeded(next);
        const top = next.drawPile.shift();
        if (top) hand.push(top);
      }
      next.lastCardDeclared[player] = false;
    } else {
      next.phase = "ENDED";
      next.outcome = { type: "WIN", winner: player, finalScores: scoreHands(next) };
      return next;
    }
  }

  advanceTurn(next, extraAdvance);
  return next;
}

function applyDraw(
  state: WhotGameState,
  player: PlayerId,
  payload: DrawCardPayload,
): WhotGameState {
  if (state.phase !== "IN_PLAY") throw new RuleError("Game is not in play");
  if (currentPlayer(state) !== player) throw new RuleError("Not your turn");
  if (state.pendingPenalty) {
    throw new RuleError("Pending penalty — accept or stack");
  }

  const next = clone(state);
  reshuffleIfNeeded(next);
  if (next.drawPile.length === 0) {
    if (next.rulesConfig.emptyDrawPilePolicy === "stalemate") {
      next.phase = "ENDED";
      next.outcome = {
        type: "STALEMATE",
        reason: "DRAW_PILE_EXHAUSTED",
        finalScores: scoreHands(next),
      };
      return next;
    }
    // No reshuffle possible (only top card left) — stalemate.
    next.phase = "ENDED";
    next.outcome = {
      type: "STALEMATE",
      reason: "DRAW_PILE_EXHAUSTED",
      finalScores: scoreHands(next),
    };
    return next;
  }
  const top = next.drawPile.shift()!;
  if (top.id !== payload.drawnCard.id) {
    throw new RuleError("Drawn card mismatch");
  }
  next.hands[player]!.push(top);
  // declaring "last card" is invalidated by drawing.
  next.lastCardDeclared[player] = false;
  if (next.rulesConfig.drawPolicy === "draw_ends_turn") {
    advanceTurn(next, 1);
  }
  return next;
}

function applyAcceptPenalty(
  state: WhotGameState,
  player: PlayerId,
  payload: AcceptPenaltyPayload,
): WhotGameState {
  if (!state.pendingPenalty) throw new RuleError("No pending penalty");
  if (currentPlayer(state) !== player) throw new RuleError("Not your turn");

  const next = clone(state);
  const want = state.pendingPenalty.count;
  if (payload.drawnCards.length !== want) {
    throw new RuleError(`Expected to draw ${want} cards`);
  }
  for (let i = 0; i < want; i++) {
    reshuffleIfNeeded(next);
    const top = next.drawPile.shift();
    const expected = payload.drawnCards[i]!;
    if (!top || top.id !== expected.id) {
      throw new RuleError("Penalty draw mismatch");
    }
    next.hands[player]!.push(top);
  }
  next.pendingPenalty = undefined;
  advanceTurn(next, 1);
  return next;
}

function applyDeclareLastCard(state: WhotGameState, player: PlayerId): WhotGameState {
  if (state.phase !== "IN_PLAY") throw new RuleError("Game is not in play");
  if (currentPlayer(state) !== player) throw new RuleError("Not your turn");
  const hand = state.hands[player] ?? [];
  if (hand.length !== 1) throw new RuleError("Last Card may only be declared with one card");
  const next = clone(state);
  next.lastCardDeclared[player] = true;
  return next;
}

export function scoreHands(state: WhotGameState): Record<PlayerId, number> {
  const scores: Record<PlayerId, number> = {};
  for (const pid of state.playerOrder) {
    scores[pid] = (state.hands[pid] ?? []).reduce((acc, c) => acc + c.number, 0);
  }
  return scores;
}

export function hashState(state: WhotGameState): string {
  // Hash only authoritative public fields for state digest.
  const trimmed = {
    phase: state.phase,
    rulesHash: state.rulesHash,
    playerOrder: state.playerOrder,
    currentPlayerIndex: state.currentPlayerIndex,
    direction: state.direction,
    handCounts: Object.fromEntries(
      state.playerOrder.map((p) => [p, (state.hands[p] ?? []).length]),
    ),
    discardTop: topDiscard(state)?.id,
    discardSize: state.discardPile.length,
    drawSize: state.drawPile.length,
    calledShape: state.calledShape,
    pendingPenalty: state.pendingPenalty,
    outcome: state.outcome,
    reshuffleCount: state.reshuffleCount,
  };
  return hashCanonical(trimmed);
}

export type Shape_ = Shape;
export type Card_ = Card;
