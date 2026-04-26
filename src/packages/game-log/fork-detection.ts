import type { PlayerId, SignedEvent } from "@protocol-core/event-types";

export type ForkEvidence = {
  playerId: PlayerId;
  eventA: SignedEvent;
  eventB: SignedEvent;
};

export class ForkDetector {
  // Map of (actor + sequence + previousEventHash) → eventHash. Two distinct
  // hashes for the same key mean the actor signed conflicting events at the
  // same chain position.
  private seen = new Map<string, SignedEvent>();

  private keyOf(e: SignedEvent): string {
    return `${e.actor}|${e.sequence}|${e.previousEventHash}`;
  }

  observe(event: SignedEvent): ForkEvidence | undefined {
    const key = this.keyOf(event);
    const prior = this.seen.get(key);
    if (prior && prior.eventHash !== event.eventHash) {
      return { playerId: event.actor, eventA: prior, eventB: event };
    }
    if (!prior) this.seen.set(key, event);
    return undefined;
  }
}
