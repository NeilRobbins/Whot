import type { PlayerId, SignedEvent } from "@protocol-core/event-types";
import type { ForkEvidence } from "./fork-detection";

export type InvalidEventEvidence = {
  kind: "INVALID_EVENT";
  event: SignedEvent;
  reason: string;
};

export type TimeoutEvidence = {
  kind: "TIMEOUT";
  playerId: PlayerId;
  expectedAfterEventHash: string;
  reason: string;
};

export type DisputeEvidence = ForkEvidence | InvalidEventEvidence | TimeoutEvidence;

export type DisputeBundle = {
  schemaVersion: "1";
  gameId: string;
  rulesHash: string;
  rosterHash: string;
  events: SignedEvent[];
  finalStateHash?: string;
  evidence: DisputeEvidence[];
  exportedAtClientMs: number;
};

export function buildDisputeBundle(args: {
  gameId: string;
  rulesHash: string;
  rosterHash: string;
  events: readonly SignedEvent[];
  finalStateHash?: string;
  evidence: readonly DisputeEvidence[];
}): DisputeBundle {
  return {
    schemaVersion: "1",
    gameId: args.gameId,
    rulesHash: args.rulesHash,
    rosterHash: args.rosterHash,
    events: args.events.slice(),
    finalStateHash: args.finalStateHash,
    evidence: args.evidence.slice(),
    exportedAtClientMs: Date.now(),
  };
}

export function disputeBundleFilename(bundle: DisputeBundle): string {
  return `whot-dispute-${bundle.gameId.slice(0, 8)}-${bundle.exportedAtClientMs}.json`;
}
