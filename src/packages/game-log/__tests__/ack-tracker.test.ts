import { describe, it, expect } from "vitest";
import { AckTracker } from "../ack-tracker";
import { generateIdentity } from "@trust-core/identity";
import { signEvent } from "@trust-core/signatures";
import { signAck } from "@trust-core/acks";
import { ZERO_HASH } from "@protocol-core/hashing";
import type { BaseEvent } from "@protocol-core/event-types";

async function makeEvent(id: { privateKey: string; publicKey: string; playerId: string }) {
  const base: BaseEvent<"PING", { v: number }> = {
    gameId: "g",
    sequence: 0,
    type: "PING",
    actor: id.playerId,
    payload: { v: 1 },
    previousEventHash: ZERO_HASH,
  };
  return signEvent(base, id.privateKey, id.publicKey);
}

describe("AckTracker", () => {
  it("returns final=false when no acks recorded", async () => {
    const a = await generateIdentity();
    const tracker = new AckTracker();
    tracker.setRoster([a.playerId, "p2"]);
    const evt = await makeEvent(a);
    expect(tracker.status(evt).final).toBe(false);
    expect(tracker.status(evt).ackCount).toBe(0);
  });

  it("self-ack counts toward finality", async () => {
    const a = await generateIdentity();
    const tracker = new AckTracker();
    tracker.setRoster([a.playerId]);
    const evt = await makeEvent(a);
    tracker.recordSelfAck(evt);
    expect(tracker.status(evt).final).toBe(true);
  });

  it("rejects acks with bad signatures", async () => {
    const a = await generateIdentity();
    const b = await generateIdentity();
    const tracker = new AckTracker();
    tracker.setRoster([a.playerId, b.playerId]);
    const evt = await makeEvent(a);
    tracker.recordSelfAck(evt);
    const goodAck = await signAck(evt.eventHash, b.playerId, b.privateKey, b.publicKey);
    const badAck = { ...goodAck, signature: "00".repeat(64) };
    expect(await tracker.record(badAck)).toBe(false);
    expect(tracker.status(evt).final).toBe(false);
    expect(await tracker.record(goodAck)).toBe(true);
    expect(tracker.status(evt).final).toBe(true);
  });

  it("ignores acks from non-rostered players for finality", async () => {
    const a = await generateIdentity();
    const stranger = await generateIdentity();
    const tracker = new AckTracker();
    tracker.setRoster([a.playerId]);
    const evt = await makeEvent(a);
    tracker.recordSelfAck(evt);
    const strangerAck = await signAck(evt.eventHash, stranger.playerId, stranger.privateKey, stranger.publicKey);
    expect(await tracker.record(strangerAck)).toBe(true);
    // Final because the only roster member (a) has acked. Stranger's ack does
    // not regress finality.
    expect(tracker.status(evt).final).toBe(true);
    expect(tracker.status(evt).ackingPlayers).toEqual([a.playerId]);
  });
});
