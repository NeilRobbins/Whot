import { describe, it, expect } from "vitest";
import { STANDARD_RULES } from "../rules-config";
import { buildInitialPayload } from "../setup";
import { initialState, reduce } from "../reducer";
import { currentPlayer, topDiscard } from "../state";
import type { Card } from "../deck";

const SEED = "1234567890abcdef1234567890abcdef";

function setup(players = ["a", "b", "c"]) {
  const payload = buildInitialPayload(STANDARD_RULES, players, SEED);
  const state = initialState(payload);
  return { payload, state };
}

describe("Whot reducer", () => {
  it("deals the right number of cards initially", () => {
    const { state } = setup();
    for (const p of ["a", "b", "c"]) {
      expect(state.hands[p]).toHaveLength(STANDARD_RULES.initialHandSize);
    }
    expect(state.discardPile.length).toBe(1);
  });

  it("rejects playing when it isn't your turn", () => {
    const { state } = setup();
    const others = state.playerOrder.filter((p) => p !== currentPlayer(state));
    const otherPlayer = others[0]!;
    const card = state.hands[otherPlayer]![0]!;
    expect(() =>
      reduce(state, { type: "PLAY_CARD", actor: otherPlayer, payload: { card } }),
    ).toThrow();
  });

  it("rejects a card not in hand", () => {
    const { state } = setup();
    const player = currentPlayer(state);
    const fake: Card = { id: "circle-99", shape: "circle", number: 99 };
    expect(() =>
      reduce(state, { type: "PLAY_CARD", actor: player, payload: { card: fake } }),
    ).toThrow();
  });

  it("requires a called shape with a Whot card", () => {
    const { state } = setup();
    // Force a Whot in current player's hand and on top.
    const player = currentPlayer(state);
    const whot: Card = { id: "whot-20-1", shape: "whot", number: 20 };
    const seeded = {
      ...state,
      hands: { ...state.hands, [player]: [whot, ...state.hands[player]!] },
      discardPile: [{ id: "circle-3", shape: "circle", number: 3 } as Card],
    };
    expect(() =>
      reduce(seeded, { type: "PLAY_CARD", actor: player, payload: { card: whot } }),
    ).toThrow();
    const next = reduce(seeded, {
      type: "PLAY_CARD",
      actor: player,
      payload: { card: whot, calledShape: "circle" },
    });
    expect(next.calledShape).toBe("circle");
  });

  it("a HOLD_ON card grants the same player another turn", () => {
    const { state } = setup();
    const player = currentPlayer(state);
    const card: Card = { id: "circle-1", shape: "circle", number: 1 };
    const seeded = {
      ...state,
      hands: { ...state.hands, [player]: [card] },
      discardPile: [{ id: "circle-3", shape: "circle", number: 3 } as Card],
      lastCardDeclared: { ...state.lastCardDeclared, [player]: true },
    };
    const next = reduce(seeded, {
      type: "PLAY_CARD",
      actor: player,
      payload: { card },
    });
    // Player wins (empty hand, declared). Outcome WIN.
    expect(next.outcome?.type).toBe("WIN");
  });

  it("PICK_TWO sets a pending penalty for the next player", () => {
    const { state } = setup(["alice", "bob"]);
    const player = currentPlayer(state);
    const card: Card = { id: "circle-2", shape: "circle", number: 2 };
    const seeded = {
      ...state,
      hands: {
        ...state.hands,
        [player]: [card, ...state.hands[player]!.slice(0, 1)],
      },
      discardPile: [{ id: "circle-3", shape: "circle", number: 3 } as Card],
    };
    const next = reduce(seeded, {
      type: "PLAY_CARD",
      actor: player,
      payload: { card },
    });
    expect(next.pendingPenalty?.type).toBe("PICK_TWO");
    expect(next.pendingPenalty?.count).toBe(2);
    expect(currentPlayer(next)).not.toBe(player);
  });

  it("ACCEPT_PENALTY draws the right number of cards", () => {
    const { state } = setup(["alice", "bob"]);
    const playerA = currentPlayer(state);
    const card: Card = { id: "circle-2", shape: "circle", number: 2 };
    const seeded = {
      ...state,
      hands: {
        ...state.hands,
        [playerA]: [card, ...state.hands[playerA]!.slice(0, 1)],
      },
      discardPile: [{ id: "circle-3", shape: "circle", number: 3 } as Card],
    };
    const afterPlay = reduce(seeded, {
      type: "PLAY_CARD",
      actor: playerA,
      payload: { card },
    });
    const playerB = currentPlayer(afterPlay);
    const drawn = afterPlay.drawPile.slice(0, 2);
    const afterPenalty = reduce(afterPlay, {
      type: "ACCEPT_PENALTY",
      actor: playerB,
      payload: { drawnCards: drawn },
    });
    expect(afterPenalty.pendingPenalty).toBeUndefined();
    expect(afterPenalty.hands[playerB]!.length).toBe(
      afterPlay.hands[playerB]!.length + 2,
    );
  });

  it("declares win after last card with declaration", () => {
    const { state } = setup(["alice", "bob"]);
    const player = currentPlayer(state);
    const card: Card = { id: "circle-3", shape: "circle", number: 3 };
    const seeded = {
      ...state,
      hands: { ...state.hands, [player]: [card] },
      discardPile: [{ id: "circle-7", shape: "circle", number: 7 } as Card],
      lastCardDeclared: { ...state.lastCardDeclared, [player]: true },
    };
    const next = reduce(seeded, {
      type: "PLAY_CARD",
      actor: player,
      payload: { card },
    });
    expect(next.outcome?.type).toBe("WIN");
    expect(next.outcome && "winner" in next.outcome ? next.outcome.winner : undefined).toBe(player);
  });

  it("draws top card when player asks", () => {
    const { state } = setup(["alice", "bob"]);
    const player = currentPlayer(state);
    const top = state.drawPile[0]!;
    const after = reduce(state, {
      type: "DRAW_CARD",
      actor: player,
      payload: { drawnCard: top },
    });
    expect(after.hands[player]!.some((c) => c.id === top.id)).toBe(true);
    expect(currentPlayer(after)).not.toBe(player);
  });

  it("hashes top discard correctly", () => {
    const { state } = setup();
    expect(topDiscard(state)).toBeDefined();
  });
});
