import type { PlayerId, Player, RulesHash } from "@protocol-core/event-types";

export type LobbyPhase = "CREATED" | "JOINING" | "ROSTER_LOCKED" | "GAME_STARTING";

export type LobbyState = {
  gameId: string;
  hostPlayerId: PlayerId;
  rulesHash: RulesHash;
  phase: LobbyPhase;
  players: Player[];
  ready: Record<PlayerId, boolean>;
  rosterLockedRoster?: PlayerId[];
};

export function newLobby(args: {
  gameId: string;
  hostPlayerId: PlayerId;
  rulesHash: RulesHash;
  host: Player;
}): LobbyState {
  return {
    gameId: args.gameId,
    hostPlayerId: args.hostPlayerId,
    rulesHash: args.rulesHash,
    phase: "JOINING",
    players: [args.host],
    ready: { [args.hostPlayerId]: false },
  };
}

export function admit(state: LobbyState, player: Player): LobbyState {
  if (state.players.some((p) => p.playerId === player.playerId)) return state;
  return {
    ...state,
    players: [...state.players, player],
    ready: { ...state.ready, [player.playerId]: false },
  };
}

export function setReady(state: LobbyState, playerId: PlayerId, ready: boolean): LobbyState {
  return {
    ...state,
    ready: { ...state.ready, [playerId]: ready },
  };
}

export function remove(state: LobbyState, playerId: PlayerId): LobbyState {
  if (playerId === state.hostPlayerId) return state;
  const { [playerId]: _, ...rest } = state.ready;
  return {
    ...state,
    players: state.players.filter((p) => p.playerId !== playerId),
    ready: rest,
  };
}

export function canLockRoster(state: LobbyState, minPlayers = 2): boolean {
  if (state.players.length < minPlayers) return false;
  return state.players.every((p) => state.ready[p.playerId]);
}

export function lockRoster(state: LobbyState): LobbyState {
  return {
    ...state,
    phase: "ROSTER_LOCKED",
    rosterLockedRoster: state.players.map((p) => p.playerId),
  };
}
