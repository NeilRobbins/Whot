import type { PlayerId, SignedEvent } from "@protocol-core/event-types";
import { verifyAck, type SignedAck } from "@trust-core/acks";

export type FinalityStatus = {
  eventHash: string;
  sequence: number;
  ackCount: number;
  required: number;
  final: boolean;
  ackingPlayers: PlayerId[];
  missingPlayers: PlayerId[];
};

/**
 * Tracks which rostered players have signed ACKs over which events. An event
 * is final when every rostered player has acknowledged it.
 *
 * Self-ACKs are accepted: a player implicitly acknowledges its own events.
 */
export class AckTracker {
  private acksByHash = new Map<string, Map<PlayerId, SignedAck>>();
  private roster: PlayerId[] = [];

  setRoster(roster: PlayerId[]): void {
    this.roster = roster.slice();
  }

  /**
   * Implicit self-ack — when a client appends its own event to its log,
   * it has by definition seen it.
   */
  recordSelfAck(event: SignedEvent): void {
    this.note(event.eventHash, {
      eventHash: event.eventHash,
      signerPlayerId: event.actor,
      signerPublicKey: event.publicKey,
      signature: event.signature, // not used for verification on self-ack
    });
  }

  async record(ack: SignedAck): Promise<boolean> {
    if (!(await verifyAck(ack))) return false;
    this.note(ack.eventHash, ack);
    return true;
  }

  private note(eventHash: string, ack: SignedAck): void {
    let map = this.acksByHash.get(eventHash);
    if (!map) {
      map = new Map();
      this.acksByHash.set(eventHash, map);
    }
    map.set(ack.signerPlayerId, ack);
  }

  status(event: SignedEvent): FinalityStatus {
    const map = this.acksByHash.get(event.eventHash) ?? new Map<PlayerId, SignedAck>();
    const acking = this.roster.filter((p) => map.has(p));
    const missing = this.roster.filter((p) => !map.has(p));
    const required = this.roster.length;
    return {
      eventHash: event.eventHash,
      sequence: event.sequence,
      ackCount: acking.length,
      required,
      final: required > 0 && acking.length === required,
      ackingPlayers: acking,
      missingPlayers: missing,
    };
  }
}
