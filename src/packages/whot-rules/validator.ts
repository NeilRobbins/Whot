import type { Card, Shape } from "./deck";
import { activeMatchShape, currentPlayer, topDiscard, type WhotGameState } from "./state";
import type { PlayerId } from "@protocol-core/event-types";

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function isWhotCard(card: Card): boolean {
  return card.shape === "whot";
}

export function getSpecial(state: WhotGameState, card: Card):
  | "HOLD_ON"
  | "PICK_TWO"
  | "PICK_THREE"
  | "SUSPEND"
  | "GENERAL_MARKET"
  | "WHOT"
  | undefined {
  const sc = state.rulesConfig.specialCards;
  if (sc.holdOn?.includes(card.number) && card.shape !== "whot") return "HOLD_ON";
  if (sc.pickTwo?.includes(card.number) && card.shape !== "whot") return "PICK_TWO";
  if (sc.pickThree?.includes(card.number) && card.shape !== "whot") return "PICK_THREE";
  if (sc.suspend?.includes(card.number) && card.shape !== "whot") return "SUSPEND";
  if (sc.generalMarket?.includes(card.number) && card.shape !== "whot") return "GENERAL_MARKET";
  if (card.shape === "whot") return "WHOT";
  return undefined;
}

export function validatePlay(
  state: WhotGameState,
  player: PlayerId,
  card: Card,
  calledShape: Shape | undefined,
): ValidationResult {
  if (state.phase !== "IN_PLAY") return { ok: false, reason: "Game is not in play" };
  if (currentPlayer(state) !== player) return { ok: false, reason: "Not your turn" };

  const hand = state.hands[player] ?? [];
  if (!hand.some((c) => c.id === card.id)) {
    return { ok: false, reason: "You do not own that card" };
  }

  // Pending penalty: only counterable by stacking the same penalty card type,
  // or in this MVP, only ACCEPT_PENALTY clears it. We disallow play unless the
  // card matches the same penalty type and stacking is enabled.
  if (state.pendingPenalty) {
    const special = getSpecial(state, card);
    const pp = state.pendingPenalty;
    if (pp.type === "PICK_TWO") {
      if (!(special === "PICK_TWO" && state.rulesConfig.stacking.pickTwo)) {
        return { ok: false, reason: "Pending Pick Two — accept or stack a 2" };
      }
    } else if (pp.type === "PICK_THREE") {
      if (!(special === "PICK_THREE" && state.rulesConfig.stacking.pickThree)) {
        return { ok: false, reason: "Pending Pick Three — accept or stack a 5" };
      }
    }
  }

  // Whot card always playable; must declare a shape.
  if (isWhotCard(card)) {
    if (!calledShape || calledShape === "whot") {
      return { ok: false, reason: "Call a shape after a Whot card" };
    }
    return { ok: true };
  }

  // Non-whot: must match shape or number with the active matcher.
  const top = topDiscard(state);
  if (!top) return { ok: true }; // first play, anything goes
  const matchShape = activeMatchShape(state);
  if (top.shape === "whot") {
    // After a Whot was played a calledShape must have been set.
    if (!matchShape) return { ok: false, reason: "Awaiting called shape" };
    if (card.shape !== matchShape) {
      return { ok: false, reason: `Must play a ${matchShape}` };
    }
    return { ok: true };
  }
  if (card.shape === matchShape) return { ok: true };
  if (card.number === top.number) return { ok: true };
  return { ok: false, reason: `Must match ${matchShape ?? top.shape} or ${top.number}` };
}

export function hasAnyLegalMove(state: WhotGameState, player: PlayerId): boolean {
  const hand = state.hands[player] ?? [];
  return hand.some((card) => {
    const calledShape: Shape | undefined = card.shape === "whot" ? "circle" : undefined;
    return validatePlay(state, player, card, calledShape).ok;
  });
}
