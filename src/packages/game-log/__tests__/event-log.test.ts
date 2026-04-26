import { describe, it, expect } from "vitest";
import { EventLog, ForkDetector } from "../index";
import { generateIdentity } from "@trust-core/identity";
import { signEvent } from "@trust-core/signatures";
import { ZERO_HASH } from "@protocol-core/hashing";
import type { BaseEvent } from "@protocol-core/event-types";

async function makeSignedEvent(
  identity: { privateKey: string; publicKey: string; playerId: string },
  sequence: number,
  previousEventHash: string,
  payload: unknown,
) {
  const base: BaseEvent<"PING", unknown> = {
    gameId: "g",
    sequence,
    type: "PING",
    actor: identity.playerId,
    payload,
    previousEventHash,
  };
  return signEvent(base, identity.privateKey, identity.publicKey);
}

describe("EventLog", () => {
  it("appends in order, rejects out of order, rejects bad chain", async () => {
    const id = await generateIdentity();
    const log = new EventLog();
    const e0 = await makeSignedEvent(id, 0, ZERO_HASH, { v: 0 });
    expect((await log.append(e0)).ok).toBe(true);
    const e1 = await makeSignedEvent(id, 1, e0.eventHash, { v: 1 });
    expect((await log.append(e1)).ok).toBe(true);
    const dup = await log.append(e1);
    expect(dup.ok).toBe(false);
    const wrongChain = await makeSignedEvent(id, 2, ZERO_HASH, { v: 2 });
    const r = await log.append(wrongChain);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("BAD_CHAIN");
  });

  it("rejects events with bad signatures", async () => {
    const id = await generateIdentity();
    const log = new EventLog();
    const e0 = await makeSignedEvent(id, 0, ZERO_HASH, { v: 0 });
    const tampered = { ...e0, payload: { v: 999 } };
    const r = await log.append(tampered);
    expect(r.ok).toBe(false);
  });
});

describe("ForkDetector", () => {
  it("detects two events at same chain position", async () => {
    const id = await generateIdentity();
    const det = new ForkDetector();
    const a = await makeSignedEvent(id, 0, ZERO_HASH, { v: "A" });
    const b = await makeSignedEvent(id, 0, ZERO_HASH, { v: "B" });
    expect(det.observe(a)).toBeUndefined();
    const evidence = det.observe(b);
    expect(evidence).toBeDefined();
    expect(evidence?.eventA.eventHash).toBe(a.eventHash);
    expect(evidence?.eventB.eventHash).toBe(b.eventHash);
  });

  it("does not flag identical events", async () => {
    const id = await generateIdentity();
    const det = new ForkDetector();
    const a = await makeSignedEvent(id, 0, ZERO_HASH, { v: "A" });
    expect(det.observe(a)).toBeUndefined();
    expect(det.observe(a)).toBeUndefined();
  });
});
