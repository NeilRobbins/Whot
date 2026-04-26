import type { BaseEvent, SignedEvent } from "@protocol-core/event-types";
import { ZERO_HASH } from "@protocol-core/hashing";
import { signEvent } from "@trust-core/signatures";
import { generateIdentity, type PlayerIdentity } from "@trust-core/identity";
import { EventLog, ForkDetector } from "@game-log/index";

export type SimulatedNode = {
  identity: PlayerIdentity;
  log: EventLog;
  fork: ForkDetector;
  deliver: (event: SignedEvent) => Promise<{
    accepted: boolean;
    reason?: string;
    fork?: boolean;
  }>;
  signNext: <T extends string, P>(
    type: T,
    payload: P,
    overrides?: Partial<BaseEvent<T, P>>,
  ) => Promise<SignedEvent<T, P>>;
};

export async function newNode(): Promise<SimulatedNode> {
  const identity = await generateIdentity();
  const log = new EventLog();
  const fork = new ForkDetector();
  return {
    identity,
    log,
    fork,
    deliver: async (event) => {
      const evidence = fork.observe(event);
      const r = await log.append(event);
      if (!r.ok) return { accepted: false, reason: r.reason, fork: !!evidence };
      return { accepted: true, fork: !!evidence };
    },
    signNext: async (type, payload, overrides = {}) => {
      const base: BaseEvent<typeof type, typeof payload> = {
        gameId: overrides.gameId ?? "g",
        sequence: overrides.sequence ?? log.tipSequence + 1,
        type,
        actor: overrides.actor ?? identity.playerId,
        payload,
        previousEventHash: overrides.previousEventHash ?? log.tipHash,
        rulesHash: overrides.rulesHash,
        createdAtClientMs: overrides.createdAtClientMs,
      };
      return signEvent(base, identity.privateKey, identity.publicKey);
    },
  };
}

export const ZERO = ZERO_HASH;
