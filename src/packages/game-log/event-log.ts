import type { SignedEvent } from "@protocol-core/event-types";
import { ZERO_HASH } from "@protocol-core/hashing";
import { verifyEvent } from "@trust-core/signatures";

export type AppendResult =
  | { ok: true }
  | { ok: false; reason: "BAD_SIGNATURE" | "BAD_CHAIN" | "OUT_OF_ORDER" | "DUPLICATE" };

export class EventLog {
  private events: SignedEvent[] = [];
  private byHash = new Map<string, SignedEvent>();

  get length(): number {
    return this.events.length;
  }

  get tipHash(): string {
    const last = this.events[this.events.length - 1];
    return last ? last.eventHash : ZERO_HASH;
  }

  get tipSequence(): number {
    return this.events.length === 0 ? -1 : this.events[this.events.length - 1]!.sequence;
  }

  all(): readonly SignedEvent[] {
    return this.events;
  }

  has(hash: string): boolean {
    return this.byHash.has(hash);
  }

  async append(event: SignedEvent): Promise<AppendResult> {
    if (this.byHash.has(event.eventHash)) return { ok: false, reason: "DUPLICATE" };
    if (event.sequence !== this.events.length) {
      return { ok: false, reason: "OUT_OF_ORDER" };
    }
    if (event.previousEventHash !== this.tipHash) {
      return { ok: false, reason: "BAD_CHAIN" };
    }
    if (!(await verifyEvent(event))) {
      return { ok: false, reason: "BAD_SIGNATURE" };
    }
    this.events.push(event);
    this.byHash.set(event.eventHash, event);
    return { ok: true };
  }

  /**
   * For broadcast: the signed events newer than `fromSequence`.
   */
  since(fromSequence: number): SignedEvent[] {
    return this.events.filter((e) => e.sequence > fromSequence);
  }
}
