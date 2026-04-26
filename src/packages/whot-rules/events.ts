import type { PlayerId } from "@protocol-core/event-types";
import type { Card, Shape } from "./deck";
import type { WhotRulesConfig } from "./rules-config";
import type { GameOutcome } from "./state";

export type GameInitialisedPayload = {
  rulesConfig: WhotRulesConfig;
  rulesHash: string;
  playerOrder: PlayerId[];
  deckSeedHex: string; // dealer-mode shared seed for deterministic shuffle
  initialHands: Record<PlayerId, Card[]>;
  initialDiscard: Card;
  initialDrawPile: Card[];
};

export type PlayCardPayload = {
  card: Card;
  calledShape?: Shape; // required if card is a Whot
};

export type DrawCardPayload = {
  drawnCard: Card; // dealer mode: top of pile, deterministic
};

export type DeclareLastCardPayload = Record<string, never>;

export type AcceptPenaltyPayload = {
  drawnCards: Card[];
};

export type GameEndedPayload = {
  outcome: GameOutcome;
  finalStateHash: string;
};

export type WhotEventMap = {
  GAME_INITIALISED: GameInitialisedPayload;
  PLAY_CARD: PlayCardPayload;
  DRAW_CARD: DrawCardPayload;
  DECLARE_LAST_CARD: DeclareLastCardPayload;
  ACCEPT_PENALTY: AcceptPenaltyPayload;
  GAME_ENDED: GameEndedPayload;
};

export type WhotEventType = keyof WhotEventMap;
