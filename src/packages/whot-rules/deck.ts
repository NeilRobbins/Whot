/**
 * Whot! deck definition.
 *
 * Standard Nigerian Whot deck, 54 cards:
 *   Circles  : 1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14
 *   Triangles: 1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14
 *   Crosses  : 1, 2, 3, 5, 7, 10, 11, 13, 14
 *   Squares  : 1, 2, 3, 5, 7, 10, 11, 13, 14
 *   Stars    : 1, 2, 3, 4, 5, 7, 8
 *   Whot     : 20 (x5)
 */
export type Shape = "circle" | "triangle" | "cross" | "square" | "star" | "whot";

export type Card = {
  id: string; // canonical id, e.g. "circle-7" or "whot-20-3"
  shape: Shape;
  number: number;
};

const NUMBERS: Record<Exclude<Shape, "whot">, number[]> = {
  circle: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
  triangle: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
  cross: [1, 2, 3, 5, 7, 10, 11, 13, 14],
  square: [1, 2, 3, 5, 7, 10, 11, 13, 14],
  star: [1, 2, 3, 4, 5, 7, 8],
};

export function buildStandardDeck(): Card[] {
  const cards: Card[] = [];
  for (const shape of Object.keys(NUMBERS) as Array<Exclude<Shape, "whot">>) {
    for (const n of NUMBERS[shape]) {
      cards.push({ id: `${shape}-${n}`, shape, number: n });
    }
  }
  for (let i = 1; i <= 5; i++) {
    cards.push({ id: `whot-20-${i}`, shape: "whot", number: 20 });
  }
  return cards;
}

/**
 * Deterministic shuffle (Fisher-Yates) seeded by a 32-byte hex string.
 * Uses xorshift over bytes of the seed for reproducibility on all clients.
 */
export function deterministicShuffle<T>(items: readonly T[], seedHex: string): T[] {
  if (!/^[0-9a-f]+$/i.test(seedHex) || seedHex.length < 16) {
    throw new Error("deterministicShuffle: seed must be hex, >= 16 chars");
  }
  const out = items.slice();
  let s0 = parseInt(seedHex.slice(0, 8), 16) >>> 0;
  let s1 = parseInt(seedHex.slice(8, 16), 16) >>> 0;
  const next = () => {
    // xorshift128+
    let x = s0;
    const y = s1;
    s0 = y;
    x ^= x << 23;
    x ^= x >>> 17;
    x ^= y ^ (y >>> 26);
    s1 = x >>> 0;
    return ((s0 + s1) >>> 0) / 0x1_0000_0000;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}

export function cardValue(card: Card): number {
  return card.number;
}
