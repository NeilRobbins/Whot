import { describe, it, expect } from "vitest";
import { newLobby, admit, setReady, canLockRoster, lockRoster, remove } from "../lobby-state";
import type { Player } from "@protocol-core/event-types";

const host: Player = {
  playerId: "h",
  displayName: "Host",
  publicKey: "pk-h",
  role: "HOST",
};
const alice: Player = {
  playerId: "a",
  displayName: "Alice",
  publicKey: "pk-a",
  role: "PLAYER",
};
const bob: Player = {
  playerId: "b",
  displayName: "Bob",
  publicKey: "pk-b",
  role: "PLAYER",
};

describe("lobby reducer", () => {
  it("admits new players idempotently", () => {
    let state = newLobby({ gameId: "g", hostPlayerId: "h", rulesHash: "rh", host });
    state = admit(state, alice);
    state = admit(state, alice);
    expect(state.players).toHaveLength(2);
  });

  it("allows roster lock only when all are ready and minimum reached", () => {
    let state = newLobby({ gameId: "g", hostPlayerId: "h", rulesHash: "rh", host });
    state = admit(state, alice);
    expect(canLockRoster(state)).toBe(false);
    state = setReady(state, "h", true);
    state = setReady(state, "a", true);
    expect(canLockRoster(state)).toBe(true);
  });

  it("locks the roster", () => {
    let state = newLobby({ gameId: "g", hostPlayerId: "h", rulesHash: "rh", host });
    state = admit(state, alice);
    state = setReady(state, "h", true);
    state = setReady(state, "a", true);
    state = lockRoster(state);
    expect(state.phase).toBe("ROSTER_LOCKED");
    expect(state.rosterLockedRoster).toEqual(["h", "a"]);
  });

  it("does not allow removing the host", () => {
    let state = newLobby({ gameId: "g", hostPlayerId: "h", rulesHash: "rh", host });
    state = admit(state, alice);
    state = admit(state, bob);
    const after = remove(state, "h");
    expect(after.players.some((p) => p.playerId === "h")).toBe(true);
  });
});
