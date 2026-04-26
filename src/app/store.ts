import { create } from "zustand";
import type { Player, PlayerId, SignedEvent } from "@protocol-core/event-types";
import type { PlayerIdentity } from "@trust-core/identity";
import type { LobbyState } from "@lobby/lobby-state";
import type { WhotGameState } from "@whot-rules/state";
import type { PeerMesh } from "@transport/peer-mesh";
import type { FinalityStatus } from "@game-log/ack-tracker";

export type Screen = "HOME" | "LOBBY" | "GAME" | "RESULT";

export type Role = "HOST" | "GUEST";

export type AppState = {
  screen: Screen;
  identity?: PlayerIdentity;
  displayName: string;
  role?: Role;
  gameId?: string;
  roomId?: string;
  joinSecret?: string;
  inviteUrl?: string;
  lobby?: LobbyState;
  game?: WhotGameState;
  log: SignedEvent[];
  mesh?: PeerMesh;
  peers: Record<string, { playerId?: PlayerId; displayName?: string; publicKey?: string }>;
  finality: FinalityStatus[];
  errorBanner?: string;
  selectedCardId?: string;
  whotShapePicker?: { cardId: string };
  setDisplayName: (name: string) => void;
  setError: (m?: string) => void;
  setScreen: (s: Screen) => void;
  setLobby: (l: LobbyState | undefined) => void;
  setGame: (g: WhotGameState | undefined) => void;
  setIdentity: (i: PlayerIdentity) => void;
  setMesh: (m: PeerMesh | undefined) => void;
  appendEvent: (e: SignedEvent) => void;
  resetEvents: () => void;
  setFinality: (f: FinalityStatus[]) => void;
  setPeerInfo: (peerId: string, info: { playerId?: PlayerId; displayName?: string; publicKey?: string }) => void;
  removePeer: (peerId: string) => void;
  setSelectedCard: (id?: string) => void;
  setWhotShapePicker: (v?: { cardId: string }) => void;
  setSession: (args: {
    role: Role;
    gameId: string;
    roomId: string;
    joinSecret?: string;
    inviteUrl?: string;
  }) => void;
  reset: () => void;
};

const initialDisplayName = (): string => {
  const stored = localStorage.getItem("whot.displayName");
  if (stored) return stored;
  const animals = ["Lion", "Eagle", "Tiger", "Falcon", "Panther", "Owl", "Hawk", "Fox"];
  return `${animals[Math.floor(Math.random() * animals.length)]}${Math.floor(Math.random() * 99) + 1}`;
};

export const useApp = create<AppState>((set) => ({
  screen: "HOME",
  displayName: initialDisplayName(),
  log: [],
  peers: {},
  finality: [],
  setDisplayName: (name) => {
    localStorage.setItem("whot.displayName", name);
    set({ displayName: name });
  },
  setError: (m) => set({ errorBanner: m }),
  setScreen: (s) => set({ screen: s }),
  setLobby: (l) => set({ lobby: l }),
  setGame: (g) => set({ game: g }),
  setIdentity: (i) => set({ identity: i }),
  setMesh: (m) => set({ mesh: m }),
  appendEvent: (e) => set((s) => ({ log: [...s.log, e] })),
  resetEvents: () => set({ log: [] }),
  setFinality: (f) => set({ finality: f }),
  setPeerInfo: (peerId, info) =>
    set((s) => ({
      peers: { ...s.peers, [peerId]: { ...s.peers[peerId], ...info } },
    })),
  removePeer: (peerId) =>
    set((s) => {
      const { [peerId]: _, ...rest } = s.peers;
      return { peers: rest };
    }),
  setSelectedCard: (id) => set({ selectedCardId: id }),
  setWhotShapePicker: (v) => set({ whotShapePicker: v }),
  setSession: (args) => set(args),
  reset: () =>
    set({
      screen: "HOME",
      gameId: undefined,
      roomId: undefined,
      joinSecret: undefined,
      inviteUrl: undefined,
      lobby: undefined,
      game: undefined,
      log: [],
      role: undefined,
      mesh: undefined,
      peers: {},
      finality: [],
      selectedCardId: undefined,
      whotShapePicker: undefined,
    }),
}));

export function makePlayerFromIdentity(
  identity: PlayerIdentity,
  displayName: string,
  role: "HOST" | "PLAYER",
): Player {
  return {
    playerId: identity.playerId,
    displayName,
    publicKey: identity.publicKey,
    role,
  };
}
