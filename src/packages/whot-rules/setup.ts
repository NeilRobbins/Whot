import type { PlayerId } from "@protocol-core/event-types";
import type { Card } from "./deck";
import { buildStandardDeck, deterministicShuffle } from "./deck";
import { hashCanonical } from "@protocol-core/hashing";
import type { GameInitialisedPayload } from "./events";
import type { WhotRulesConfig } from "./rules-config";

export function rulesHashOf(rules: WhotRulesConfig): string {
  return hashCanonical(rules);
}

/**
 * Dealer-mode initial deal. Given a deterministic seed and a player order,
 * produce the initial event payload reproducibly.
 *
 * The seed should be derived from a published source (e.g. game id, roster
 * hash, and dealer player id) so that all players can independently verify
 * the deal once it has been published.
 */
export function buildInitialPayload(
  rules: WhotRulesConfig,
  playerOrder: PlayerId[],
  deckSeedHex: string,
): GameInitialisedPayload {
  const deck = deterministicShuffle(buildStandardDeck(), deckSeedHex);
  const cursor = { i: 0 };
  const draw = (): Card => {
    const card = deck[cursor.i];
    if (!card) throw new Error("Deck exhausted during deal");
    cursor.i += 1;
    return card;
  };

  const initialHands: Record<PlayerId, Card[]> = {};
  for (const pid of playerOrder) initialHands[pid] = [];
  for (let i = 0; i < rules.initialHandSize; i++) {
    for (const pid of playerOrder) {
      initialHands[pid]!.push(draw());
    }
  }
  // Skip Whot card as initial discard if possible.
  let initialDiscard = draw();
  while (initialDiscard.shape === "whot" && cursor.i < deck.length) {
    // Place the Whot back at the bottom and try again.
    deck.push(initialDiscard);
    initialDiscard = draw();
  }
  const initialDrawPile = deck.slice(cursor.i);

  return {
    rulesConfig: rules,
    rulesHash: rulesHashOf(rules),
    playerOrder,
    deckSeedHex,
    initialHands,
    initialDiscard,
    initialDrawPile,
  };
}
