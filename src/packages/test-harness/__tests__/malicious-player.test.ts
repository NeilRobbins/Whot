import { describe, it, expect } from "vitest";
import { newNode } from "../simulated-network";
import { ZERO_HASH } from "@protocol-core/hashing";
import { signAck, verifyAck } from "@trust-core/acks";
import { AckTracker } from "@game-log/ack-tracker";

describe("malicious-player resistance", () => {
  it("rejects events with tampered payloads (signature mismatch)", async () => {
    const a = await newNode();
    const b = await newNode();
    const evt = await a.signNext("PING", { v: 1 });
    const tampered = { ...evt, payload: { v: 999 } };
    const r = await b.deliver(tampered);
    expect(r.accepted).toBe(false);
  });

  it("rejects events with mismatched eventHash (forged hash)", async () => {
    const a = await newNode();
    const b = await newNode();
    const evt = await a.signNext("PING", { v: 1 });
    const fakeHash = "ff".repeat(32);
    const r = await b.deliver({ ...evt, eventHash: fakeHash });
    expect(r.accepted).toBe(false);
  });

  it("rejects events that don't extend the chain (BAD_CHAIN)", async () => {
    const a = await newNode();
    const b = await newNode();
    const e0 = await a.signNext("PING", { v: 0 });
    await b.deliver(e0);
    // Sign an event that pretends previous hash was zero (replay-from-genesis).
    const replay = await a.signNext(
      "PING",
      { v: 1 },
      { sequence: 1, previousEventHash: ZERO_HASH },
    );
    const r = await b.deliver(replay);
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("BAD_CHAIN");
  });

  it("rejects out-of-order sequence numbers", async () => {
    const a = await newNode();
    const b = await newNode();
    const e0 = await a.signNext("PING", { v: 0 });
    await b.deliver(e0);
    const skipAhead = await a.signNext(
      "PING",
      { v: 5 },
      { sequence: 5, previousEventHash: e0.eventHash },
    );
    const r = await b.deliver(skipAhead);
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("OUT_OF_ORDER");
  });

  it("rejects duplicate events (replay)", async () => {
    const a = await newNode();
    const b = await newNode();
    const e0 = await a.signNext("PING", { v: 0 });
    expect((await b.deliver(e0)).accepted).toBe(true);
    const r = await b.deliver(e0);
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe("DUPLICATE");
  });

  it("flags forks: same player signs two distinct events at the same chain position", async () => {
    const a = await newNode();
    const b = await newNode();
    const e0 = await a.signNext("PING", { v: 0 });
    await a.deliver(e0);
    await b.deliver(e0);
    // Equivocate: build a second event that also claims sequence 1 with the
    // same previousEventHash but a different payload.
    const eA = await a.signNext("PING", { v: "A" });
    const eB = await a.signNext(
      "PING",
      { v: "B" },
      { sequence: eA.sequence, previousEventHash: eA.previousEventHash },
    );
    const r1 = await b.deliver(eA);
    const r2 = await b.deliver(eB);
    expect(r1.accepted).toBe(true);
    expect(r1.fork).toBeFalsy();
    expect(r2.fork).toBe(true);
    // The second event is rejected because eA was already taken.
    expect(r2.accepted).toBe(false);
  });

  it("rejects events signed with the wrong public key (impersonation)", async () => {
    const a = await newNode();
    const b = await newNode();
    const evt = await a.signNext("PING", { v: 1 });
    // Substitute b's public key — signature won't verify.
    const r = await b.deliver({ ...evt, publicKey: b.identity.publicKey });
    expect(r.accepted).toBe(false);
  });

  it("rejects ACKs with forged signatures", async () => {
    const a = await newNode();
    const b = await newNode();
    const ack = await signAck("00".repeat(32), a.identity.playerId, a.identity.privateKey, a.identity.publicKey);
    expect(await verifyAck(ack)).toBe(true);
    const tampered = { ...ack, eventHash: "ff".repeat(32) };
    expect(await verifyAck(tampered)).toBe(false);

    // Try recording the bad ack via the tracker — should be rejected.
    const tracker = new AckTracker();
    tracker.setRoster([a.identity.playerId, b.identity.playerId]);
    const accepted = await tracker.record(tampered);
    expect(accepted).toBe(false);
  });

  it("AckTracker reports finality only when every roster member acks", async () => {
    const a = await newNode();
    const b = await newNode();
    const c = await newNode();

    const tracker = new AckTracker();
    tracker.setRoster([a.identity.playerId, b.identity.playerId, c.identity.playerId]);

    const evt = await a.signNext("PING", { v: 1 });

    // Self-ack from a
    tracker.recordSelfAck(evt);
    expect(tracker.status(evt).final).toBe(false);

    // Ack from b
    const ackB = await signAck(
      evt.eventHash,
      b.identity.playerId,
      b.identity.privateKey,
      b.identity.publicKey,
    );
    expect(await tracker.record(ackB)).toBe(true);
    expect(tracker.status(evt).final).toBe(false);

    // Ack from c
    const ackC = await signAck(
      evt.eventHash,
      c.identity.playerId,
      c.identity.privateKey,
      c.identity.publicKey,
    );
    expect(await tracker.record(ackC)).toBe(true);
    expect(tracker.status(evt).final).toBe(true);
    expect(tracker.status(evt).missingPlayers).toEqual([]);
  });
});
