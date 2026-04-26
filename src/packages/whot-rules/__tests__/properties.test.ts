import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { STANDARD_RULES, buildInitialPayload } from "../index";
import { initialState, reduce, hashState } from "../reducer";
import { currentPlayer } from "../state";
import { validatePlay } from "../validator";
import type { Card } from "../deck";
import type { WhotGameState } from "../state";

const seedArb = fc.hexaString({ minLength: 32, maxLength: 32 });
const playersArb = fc
  .integer({ min: 2, max: 5 })
  .map((n) => Array.from({ length: n }, (_, i) => `p${i}`));

function totalCardsInPlay(state: WhotGameState): number {
  let n = state.drawPile.length + state.discardPile.length;
  for (const pid of state.playerOrder) {
    n += (state.hands[pid] ?? []).length;
  }
  return n;
}

describe("Whot reducer invariants (property-based)", () => {
  it("preserves total card count across the deal", () => {
    fc.assert(
      fc.property(seedArb, playersArb, (seed, players) => {
        const payload = buildInitialPayload(STANDARD_RULES, players, seed);
        const state = initialState(payload);
        expect(totalCardsInPlay(state)).toBe(54);
      }),
      { numRuns: 50 },
    );
  });

  it("rule reducer is deterministic: same events → same state hash", () => {
    fc.assert(
      fc.property(seedArb, playersArb, (seed, players) => {
        const a = initialState(buildInitialPayload(STANDARD_RULES, players, seed));
        const b = initialState(buildInitialPayload(STANDARD_RULES, players, seed));
        expect(hashState(a)).toBe(hashState(b));
      }),
      { numRuns: 30 },
    );
  });

  it(
    "playing any legal card preserves total cards minus the played card",
    () => {
      fc.assert(
        fc.property(seedArb, playersArb, (seed, players) => {
          const state = initialState(buildInitialPayload(STANDARD_RULES, players, seed));
          const me = currentPlayer(state);
          const hand = state.hands[me] ?? [];
          for (const card of hand) {
            const calledShape = card.shape === "whot" ? "circle" : undefined;
            if (!validatePlay(state, me, card, calledShape).ok) continue;
            const next = reduce(state, {
              type: "PLAY_CARD",
              actor: me,
              payload: { card, calledShape },
            });
            expect(totalCardsInPlay(next)).toBe(54);
          }
        }),
        { numRuns: 30 },
      );
    },
  );

  it("draw of top card always moves exactly one card", () => {
    fc.assert(
      fc.property(seedArb, playersArb, (seed, players) => {
        const state = initialState(buildInitialPayload(STANDARD_RULES, players, seed));
        const me = currentPlayer(state);
        const top = state.drawPile[0];
        if (!top) return; // possible edge case if the deal exhausts the deck
        const next = reduce(state, {
          type: "DRAW_CARD",
          actor: me,
          payload: { drawnCard: top },
        });
        expect(totalCardsInPlay(next)).toBe(54);
        expect(next.hands[me]!.length).toBe(state.hands[me]!.length + 1);
        expect(next.drawPile.length).toBe(state.drawPile.length - 1);
      }),
      { numRuns: 30 },
    );
  });

  it("an unknown card is never accepted as a play", () => {
    fc.assert(
      fc.property(seedArb, playersArb, (seed, players) => {
        const state = initialState(buildInitialPayload(STANDARD_RULES, players, seed));
        const me = currentPlayer(state);
        const fake: Card = { id: "fake-9999", shape: "circle", number: 9 };
        expect(() =>
          reduce(state, { type: "PLAY_CARD", actor: me, payload: { card: fake } }),
        ).toThrow();
      }),
      { numRuns: 20 },
    );
  });

  it("a non-current player can never make a move", () => {
    fc.assert(
      fc.property(seedArb, playersArb, (seed, players) => {
        const state = initialState(buildInitialPayload(STANDARD_RULES, players, seed));
        const others = state.playerOrder.filter((p) => p !== currentPlayer(state));
        for (const otherPlayer of others) {
          const card = state.hands[otherPlayer]?.[0];
          if (!card) continue;
          expect(() =>
            reduce(state, { type: "PLAY_CARD", actor: otherPlayer, payload: { card } }),
          ).toThrow();
        }
      }),
      { numRuns: 20 },
    );
  });
});
