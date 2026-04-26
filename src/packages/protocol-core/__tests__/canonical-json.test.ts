import { describe, it, expect } from "vitest";
import { canonicalJSON } from "../canonical-json";
import { hashCanonical } from "../hashing";

describe("canonicalJSON", () => {
  it("orders keys lexicographically", () => {
    expect(canonicalJSON({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("produces stable hashes regardless of property order", () => {
    const a = { x: 1, y: { c: 3, b: 2, a: 1 }, z: [1, 2, 3] };
    const b = { z: [1, 2, 3], y: { a: 1, b: 2, c: 3 }, x: 1 };
    expect(hashCanonical(a)).toBe(hashCanonical(b));
  });

  it("rejects NaN and Infinity", () => {
    expect(() => canonicalJSON(NaN)).toThrow();
    expect(() => canonicalJSON(Infinity)).toThrow();
  });

  it("omits undefined values", () => {
    expect(canonicalJSON({ a: 1, b: undefined, c: 2 })).toBe('{"a":1,"c":2}');
  });

  it("handles arrays preserving order", () => {
    expect(canonicalJSON([3, 1, 2])).toBe("[3,1,2]");
  });
});
