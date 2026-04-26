/**
 * Shared protocol-level event envelope.
 * Game-specific payloads live with the relevant module.
 */
export type GameId = string;
export type PlayerId = string;
export type EventHash = string;
export type RulesHash = string;
export type RosterHash = string;

export type Player = {
  playerId: PlayerId;
  displayName: string;
  publicKey: string;
  role: "HOST" | "PLAYER";
};

export type BaseEvent<TType extends string = string, TPayload = unknown> = {
  gameId: GameId;
  sequence: number;
  type: TType;
  actor: PlayerId;
  payload: TPayload;
  previousEventHash: EventHash;
  rulesHash?: RulesHash;
  createdAtClientMs?: number;
};

export type SignedEvent<TType extends string = string, TPayload = unknown> =
  BaseEvent<TType, TPayload> & {
    eventHash: EventHash;
    signature: string;
    publicKey: string;
  };
