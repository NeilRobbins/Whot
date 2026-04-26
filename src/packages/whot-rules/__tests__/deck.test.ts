import { describe, it, expect } from "vitest";
import { buildStandardDeck, deterministicShuffle } from "../deck";

describe("standard whot deck", () => {
  it("has 54 cards", () => {
    expect(buildStandardDeck()).toHaveLength(54);
  });

  it("has exactly 5 whot cards", () => {
    const deck = buildStandardDeck();
    expect(deck.filter((c) => c.shape === "whot")).toHaveLength(5);
  });

  it("has unique ids", () => {
    const deck = buildStandardDeck();
    const ids = new Set(deck.map((c) => c.id));
    expect(ids.size).toBe(deck.length);
  });
});

describe("deterministicShuffle", () => {
  it("is deterministic for the same seed", () => {
    const a = deterministicShuffle(buildStandardDeck(), "deadbeefcafef00d");
    const b = deterministicShuffle(buildStandardDeck(), "deadbeefcafef00d");
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });

  it("differs for different seeds", () => {
    const a = deterministicShuffle(buildStandardDeck(), "0123456789abcdef");
    const b = deterministicShuffle(buildStandardDeck(), "fedcba9876543210");
    expect(a.map((c) => c.id)).not.toEqual(b.map((c) => c.id));
  });

  it("preserves the multiset", () => {
    const deck = buildStandardDeck();
    const shuffled = deterministicShuffle(deck, "1111111122222222");
    expect(shuffled.slice().sort((x, y) => x.id.localeCompare(y.id))).toEqual(
      deck.slice().sort((x, y) => x.id.localeCompare(y.id)),
    );
  });
});
