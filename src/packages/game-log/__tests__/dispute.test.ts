import { describe, it, expect } from "vitest";
import { buildDisputeBundle, disputeBundleFilename } from "../dispute";
import { generateIdentity } from "@trust-core/identity";
import { signEvent } from "@trust-core/signatures";
import { ZERO_HASH } from "@protocol-core/hashing";
import type { BaseEvent } from "@protocol-core/event-types";

describe("dispute bundle", () => {
  it("packages events and evidence into a JSON-serialisable bundle", async () => {
    const id = await generateIdentity();
    const base: BaseEvent<"PING", { v: number }> = {
      gameId: "g",
      sequence: 0,
      type: "PING",
      actor: id.playerId,
      payload: { v: 1 },
      previousEventHash: ZERO_HASH,
    };
    const evt = await signEvent(base, id.privateKey, id.publicKey);

    const bundle = buildDisputeBundle({
      gameId: "g",
      rulesHash: "rh",
      rosterHash: "rsh",
      events: [evt],
      finalStateHash: "fsh",
      evidence: [
        { kind: "INVALID_EVENT", event: evt, reason: "BAD_SIGNATURE" },
      ],
    });

    expect(bundle.schemaVersion).toBe("1");
    expect(bundle.events).toHaveLength(1);
    expect(bundle.evidence).toHaveLength(1);
    // Round-trip JSON.
    const json = JSON.stringify(bundle);
    const back = JSON.parse(json);
    expect(back.events[0].eventHash).toBe(evt.eventHash);
    expect(disputeBundleFilename(bundle)).toMatch(/^whot-dispute-/);
  });
});
