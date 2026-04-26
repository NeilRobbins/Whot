import type { BaseEvent, Player, PlayerId, SignedEvent } from "@protocol-core/event-types";
import { ZERO_HASH, hashCanonical } from "@protocol-core/hashing";
import { log as diagLog } from "@protocol-core/diagnostics";
import { BUILD_ID } from "@protocol-core/build-info";
import type { PlayerIdentity } from "@trust-core/identity";
import { signEvent } from "@trust-core/signatures";
import { signAck } from "@trust-core/acks";
import {
  AckTracker,
  EventLog,
  ForkDetector,
  buildDisputeBundle,
  type DisputeBundle,
  type DisputeEvidence,
  type FinalityStatus,
  type ForkEvidence,
} from "@game-log/index";
import {
  newLobby,
  admit,
  setReady,
  remove,
  lockRoster,
  type LobbyState,
} from "@lobby/lobby-state";
import {
  STANDARD_RULES,
  buildInitialPayload,
  initialState,
  reduce,
  rulesHashOf,
  type WhotGameState,
} from "@whot-rules/index";
import { joinMesh, type ConnectionStatus, type PeerMesh } from "@transport/peer-mesh";
import { saveLocalLeaderboardEntry } from "@endgame/index";

export type LobbyEventType =
  | "GAME_CREATED"
  | "PLAYER_JOIN_REQUESTED"
  | "PLAYER_ADMITTED"
  | "PLAYER_LEFT"
  | "PLAYER_READY"
  | "PLAYER_UNREADY"
  | "ROSTER_LOCKED";

export type GameEventType =
  | "GAME_INITIALISED"
  | "PLAY_CARD"
  | "DRAW_CARD"
  | "DECLARE_LAST_CARD"
  | "ACCEPT_PENALTY"
  | "GAME_ENDED";

export type SessionListeners = {
  onLobbyChange?: (state: LobbyState) => void;
  onGameChange?: (state: WhotGameState | undefined) => void;
  onLogEvent?: (event: SignedEvent) => void;
  onError?: (msg: string) => void;
  onPeersChange?: (peers: Record<string, { playerId?: PlayerId; displayName?: string; publicKey?: string }>) => void;
  onFork?: (evidence: ForkEvidence) => void;
  onFinalityChange?: (status: FinalityStatus[]) => void;
  onConnectionStatus?: (status: ConnectionStatus) => void;
};

export type Session = {
  identity: PlayerIdentity;
  gameId: string;
  roomId: string;
  joinSecret: string;
  isHost: boolean;
  mesh: PeerMesh;
  lobby: () => LobbyState;
  game: () => WhotGameState | undefined;
  events: () => readonly SignedEvent[];
  finality: () => FinalityStatus[];
  exportDisputeBundle: () => DisputeBundle;
  // host actions
  admitPlayer: (p: Player) => Promise<void>;
  removePlayer: (id: PlayerId) => Promise<void>;
  lockRoster: () => Promise<void>;
  // any-player actions
  setReady: (ready: boolean) => Promise<void>;
  playCard: (cardId: string, calledShape?: string) => Promise<void>;
  drawCard: () => Promise<void>;
  declareLastCard: () => Promise<void>;
  acceptPenalty: () => Promise<void>;
  leave: () => void;
};

type CreateOpts = {
  identity: PlayerIdentity;
  displayName: string;
  listeners: SessionListeners;
};

type HostCreateOpts = CreateOpts;
type GuestJoinOpts = CreateOpts & {
  gameId: string;
  roomId: string;
  joinSecret: string;
};

function genId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createHostSession(opts: HostCreateOpts): Promise<Session> {
  const gameId = genId();
  const roomId = genId();
  const joinSecret = genId();
  const rules = STANDARD_RULES;
  const rulesHash = rulesHashOf(rules);

  const host: Player = {
    playerId: opts.identity.playerId,
    displayName: opts.displayName,
    publicKey: opts.identity.publicKey,
    role: "HOST",
  };
  const lobby0 = newLobby({
    gameId,
    hostPlayerId: opts.identity.playerId,
    rulesHash,
    host,
  });

  return wireSession({
    isHost: true,
    identity: opts.identity,
    displayName: opts.displayName,
    gameId,
    roomId,
    joinSecret,
    listeners: opts.listeners,
    initialLobby: lobby0,
  });
}

export async function createGuestSession(opts: GuestJoinOpts): Promise<Session> {
  // Guests start with a placeholder lobby that will be replaced once the host
  // sends a LOBBY_STATE / GAME_CREATED event.
  const placeholder: LobbyState = {
    gameId: opts.gameId,
    hostPlayerId: "",
    rulesHash: rulesHashOf(STANDARD_RULES),
    phase: "JOINING",
    players: [],
    ready: {},
  };
  return wireSession({
    isHost: false,
    identity: opts.identity,
    displayName: opts.displayName,
    gameId: opts.gameId,
    roomId: opts.roomId,
    joinSecret: opts.joinSecret,
    listeners: opts.listeners,
    initialLobby: placeholder,
  });
}

type WireOpts = {
  isHost: boolean;
  identity: PlayerIdentity;
  displayName: string;
  gameId: string;
  roomId: string;
  joinSecret: string;
  listeners: SessionListeners;
  initialLobby: LobbyState;
};

async function wireSession(o: WireOpts): Promise<Session> {
  diagLog.info("session", `wireSession ${o.isHost ? "(host)" : "(guest)"}`, {
    gameId: o.gameId,
    roomId: o.roomId,
    playerId: o.identity.playerId,
    displayName: o.displayName,
    buildId: BUILD_ID,
  });

  let lobby = o.initialLobby;
  let game: WhotGameState | undefined;
  const log = new EventLog();
  const fork = new ForkDetector();
  const acks = new AckTracker();
  const evidence: DisputeEvidence[] = [];
  const pendingEvents: SignedEvent[] = []; // events arrived ahead of tip

  const broadcastInfo: Record<string, { playerId?: PlayerId; displayName?: string; publicKey?: string }> = {};

  const emit = (e: SignedEvent) => o.listeners.onLogEvent?.(e);
  const emitLobby = () => o.listeners.onLobbyChange?.(lobby);
  const emitGame = () => o.listeners.onGameChange?.(game);
  const emitError = (m: string) => o.listeners.onError?.(m);
  const emitPeers = () => o.listeners.onPeersChange?.({ ...broadcastInfo });
  const emitFinality = () =>
    o.listeners.onFinalityChange?.(log.all().map((e) => acks.status(e)));

  function refreshRosterForAcks(): void {
    // Until roster lock, we treat the currently-known lobby players as the
    // roster. After roster lock, we use the locked roster.
    const roster = lobby.rosterLockedRoster ?? lobby.players.map((p) => p.playerId);
    acks.setRoster(roster);
    emitFinality();
  }

  const sign = async <T extends string, P>(type: T, payload: P): Promise<SignedEvent<T, P>> => {
    const base: BaseEvent<T, P> = {
      gameId: o.gameId,
      sequence: log.tipSequence + 1,
      type,
      actor: o.identity.playerId,
      payload,
      previousEventHash: log.tipHash,
      rulesHash: lobby.rulesHash,
      createdAtClientMs: Date.now(),
    };
    return signEvent(base, o.identity.privateKey, o.identity.publicKey);
  };

  const append = async (event: SignedEvent): Promise<boolean> => {
    const forkEv = fork.observe(event);
    if (forkEv) {
      diagLog.warn("session", "fork detected", { actor: forkEv.playerId });
      o.listeners.onFork?.(forkEv);
      evidence.push(forkEv);
    }
    const r = await log.append(event);
    if (!r.ok) {
      diagLog.warn("session", `append rejected: ${r.reason}`, {
        sequence: event.sequence,
        type: event.type,
        actor: event.actor,
      });
      if (r.reason === "OUT_OF_ORDER" && event.sequence > log.tipSequence + 1) {
        // Buffer the event for later, request the gap.
        if (!pendingEvents.some((e) => e.eventHash === event.eventHash)) {
          pendingEvents.push(event);
        }
        sendMissingRequest(log.tipSequence + 1);
        return false;
      }
      if (r.reason === "BAD_SIGNATURE") {
        evidence.push({ kind: "INVALID_EVENT", event, reason: "BAD_SIGNATURE" });
        emitError(`event rejected: BAD_SIGNATURE`);
        return false;
      }
      if (r.reason !== "DUPLICATE") emitError(`event rejected: ${r.reason}`);
      return false;
    }
    diagLog.info("session", `append ok seq=${event.sequence}`, {
      type: event.type,
      actor: event.actor,
      eventHash: event.eventHash,
    });
    acks.recordSelfAck(event);
    emit(event);
    applyEventToState(event);
    refreshRosterForAcks();
    // Try to flush any queued events whose sequence now matches.
    await flushPending();
    return true;
  };

  let mesh: PeerMesh | undefined;
  function sendMissingRequest(fromSequence: number): void {
    mesh?.send({ kind: "MISSING_EVENTS", fromSequence });
  }

  async function flushPending(): Promise<void> {
    if (pendingEvents.length === 0) return;
    pendingEvents.sort((a, b) => a.sequence - b.sequence);
    let progress = true;
    while (progress) {
      progress = false;
      const nextIdx = pendingEvents.findIndex(
        (e) => e.sequence === log.tipSequence + 1 && e.previousEventHash === log.tipHash,
      );
      if (nextIdx === -1) break;
      const next = pendingEvents.splice(nextIdx, 1)[0]!;
      await append(next);
      progress = true;
    }
  }

  function applyEventToState(event: SignedEvent): void {
    const t = event.type as LobbyEventType | GameEventType;
    switch (t) {
      case "GAME_CREATED": {
        const p = event.payload as { host: Player };
        lobby = newLobby({
          gameId: o.gameId,
          hostPlayerId: p.host.playerId,
          rulesHash: lobby.rulesHash,
          host: p.host,
        });
        emitLobby();
        break;
      }
      case "PLAYER_JOIN_REQUESTED": {
        // recorded; host decides admission.
        break;
      }
      case "PLAYER_ADMITTED": {
        const p = event.payload as { player: Player };
        lobby = admit(lobby, p.player);
        emitLobby();
        break;
      }
      case "PLAYER_LEFT": {
        const p = event.payload as { playerId: PlayerId };
        lobby = remove(lobby, p.playerId);
        emitLobby();
        break;
      }
      case "PLAYER_READY": {
        lobby = setReady(lobby, event.actor, true);
        emitLobby();
        break;
      }
      case "PLAYER_UNREADY": {
        lobby = setReady(lobby, event.actor, false);
        emitLobby();
        break;
      }
      case "ROSTER_LOCKED": {
        const p = event.payload as { roster: PlayerId[] };
        lobby = { ...lockRoster(lobby), rosterLockedRoster: p.roster };
        emitLobby();
        break;
      }
      case "GAME_INITIALISED": {
        const p = event.payload as Parameters<typeof initialState>[0];
        game = initialState(p);
        lobby = { ...lobby, phase: "GAME_STARTING" };
        emitLobby();
        emitGame();
        break;
      }
      case "PLAY_CARD":
      case "DRAW_CARD":
      case "DECLARE_LAST_CARD":
      case "ACCEPT_PENALTY": {
        if (!game) return;
        try {
          game = reduce(game, {
            type: t,
            actor: event.actor,
            payload: event.payload as never,
          } as Parameters<typeof reduce>[1]);
          if (game.outcome) onTerminalState();
          emitGame();
        } catch (err) {
          emitError(`rule error from ${event.actor}: ${(err as Error).message}`);
        }
        break;
      }
      case "GAME_ENDED": {
        if (game) {
          game = { ...game, phase: "ENDED" };
          emitGame();
        }
        break;
      }
    }
  }

  function onTerminalState(): void {
    if (!game?.outcome) return;
    saveLocalLeaderboardEntry({
      gameId: o.gameId,
      endedAt: Date.now(),
      outcome: game.outcome,
      players: lobby.players.map((p) => ({
        playerId: p.playerId,
        displayName: p.displayName,
        finalScore:
          game!.outcome && "finalScores" in game!.outcome
            ? (game!.outcome.finalScores ?? {})[p.playerId]
            : undefined,
      })),
    });
  }

  // Wire the mesh.
  mesh = joinMesh(o.roomId, {
    onPeerJoin: async (peerId) => {
      // Send our HELLO and full event log to the new peer.
      mesh!.sendTo(peerId, {
        kind: "HELLO",
        playerId: o.identity.playerId,
        displayName: o.displayName,
        publicKey: o.identity.publicKey,
      });
      if (log.length > 0) {
        mesh!.sendTo(peerId, { kind: "EVENT_BATCH", events: log.all().slice() });
      }
    },
    onPeerLeave: (peerId) => {
      delete broadcastInfo[peerId];
      emitPeers();
    },
    onStatus: (s) => {
      o.listeners.onConnectionStatus?.(s);
    },
    onMessage: async (msg, fromPeerId) => {
      switch (msg.kind) {
        case "HELLO": {
          broadcastInfo[fromPeerId] = {
            playerId: msg.playerId,
            displayName: msg.displayName,
            publicKey: msg.publicKey,
          };
          emitPeers();
          // If host: respond with current lobby + log.
          if (o.isHost) {
            mesh!.sendTo(fromPeerId, { kind: "EVENT_BATCH", events: log.all().slice() });
          }
          // Guests issue join request once they see who the host is.
          if (!o.isHost && lobby.hostPlayerId === "" && log.length === 0) {
            // wait for log
          }
          break;
        }
        case "EVENT": {
          await append(msg.event);
          await sendAckFor(msg.event);
          break;
        }
        case "EVENT_BATCH": {
          for (const e of msg.events) {
            await append(e);
            await sendAckFor(e);
          }
          // If guest, ensure we've requested to join after seeing GAME_CREATED.
          if (!o.isHost && lobby.phase === "JOINING" && !lobby.players.some((p) => p.playerId === o.identity.playerId)) {
            await issueJoinRequest();
          }
          break;
        }
        case "MISSING_EVENTS": {
          mesh!.sendTo(fromPeerId, {
            kind: "EVENT_BATCH",
            events: log.since(msg.fromSequence - 1),
          });
          break;
        }
        case "ACK": {
          const ok = await acks.record(msg.ack);
          if (ok) {
            emitFinality();
          } else {
            evidence.push({
              kind: "INVALID_EVENT",
              event: { ...({} as SignedEvent) },
              reason: "BAD_ACK_SIGNATURE",
            });
          }
          break;
        }
        case "PING": {
          mesh!.sendTo(fromPeerId, {
            kind: "PONG",
            lastSeenEventHash: log.tipHash,
            tipSequence: log.tipSequence,
          });
          if (msg.tipSequence > log.tipSequence) {
            mesh!.sendTo(fromPeerId, {
              kind: "MISSING_EVENTS",
              fromSequence: log.tipSequence + 1,
            });
          }
          break;
        }
        case "PONG": {
          if (msg.tipSequence > log.tipSequence) {
            mesh!.sendTo(fromPeerId, {
              kind: "MISSING_EVENTS",
              fromSequence: log.tipSequence + 1,
            });
          }
          break;
        }
        case "LOBBY_STATE":
          // informational; authoritative state derives from event log
          break;
      }
    },
  });

  async function broadcast(event: SignedEvent): Promise<void> {
    const ok = await append(event);
    if (!ok) return;
    mesh!.send({ kind: "EVENT", event });
  }

  async function sendAckFor(event: SignedEvent): Promise<void> {
    if (event.actor === o.identity.playerId) return; // self-ACK already recorded
    const ack = await signAck(
      event.eventHash,
      o.identity.playerId,
      o.identity.privateKey,
      o.identity.publicKey,
    );
    mesh!.send({ kind: "ACK", ack });
  }

  // Periodic PING for tip-sync detection.
  const pingInterval = setInterval(() => {
    if (!mesh) return;
    mesh.send({
      kind: "PING",
      lastSeenEventHash: log.tipHash,
      tipSequence: log.tipSequence,
    });
  }, 5000);

  async function issueJoinRequest(): Promise<void> {
    const me: Player = {
      playerId: o.identity.playerId,
      displayName: o.displayName,
      publicKey: o.identity.publicKey,
      role: "PLAYER",
    };
    const evt = await sign("PLAYER_JOIN_REQUESTED", { player: me, joinSecretHash: hashCanonical(o.joinSecret) });
    await broadcast(evt);
  }

  // If host: emit GAME_CREATED event as the seed.
  if (o.isHost) {
    const host: Player = {
      playerId: o.identity.playerId,
      displayName: o.displayName,
      publicKey: o.identity.publicKey,
      role: "HOST",
    };
    const created: BaseEvent<"GAME_CREATED", { host: Player; rulesHash: string }> = {
      gameId: o.gameId,
      sequence: 0,
      type: "GAME_CREATED",
      actor: o.identity.playerId,
      payload: { host, rulesHash: lobby.rulesHash },
      previousEventHash: ZERO_HASH,
      rulesHash: lobby.rulesHash,
      createdAtClientMs: Date.now(),
    };
    const signed = await signEvent(created, o.identity.privateKey, o.identity.publicKey);
    await append(signed);
  }

  return {
    identity: o.identity,
    gameId: o.gameId,
    roomId: o.roomId,
    joinSecret: o.joinSecret,
    isHost: o.isHost,
    mesh,
    lobby: () => lobby,
    game: () => game,
    events: () => log.all(),
    admitPlayer: async (player: Player) => {
      if (!o.isHost) throw new Error("Only host can admit players");
      const e = await sign("PLAYER_ADMITTED", { player });
      await broadcast(e);
    },
    removePlayer: async (playerId: PlayerId) => {
      if (!o.isHost) throw new Error("Only host can remove players");
      const e = await sign("PLAYER_LEFT", { playerId });
      await broadcast(e);
    },
    lockRoster: async () => {
      if (!o.isHost) throw new Error("Only host can lock roster");
      if (!lobby.players.every((p) => lobby.ready[p.playerId])) {
        throw new Error("Not all players are ready");
      }
      const roster = lobby.players.map((p) => p.playerId);
      const lockEvent = await sign("ROSTER_LOCKED", {
        roster,
        rulesHash: lobby.rulesHash,
      });
      await broadcast(lockEvent);

      // Derive deterministic player order and seed.
      const order = derivePlayerOrder(o.gameId, roster);
      const deckSeedHex = hashCanonical({
        gameId: o.gameId,
        roster,
        salt: genId(),
      });
      const payload = buildInitialPayload(STANDARD_RULES, order, deckSeedHex);
      const initEvent = await sign("GAME_INITIALISED", payload);
      await broadcast(initEvent);
    },
    setReady: async (ready: boolean) => {
      const t = ready ? "PLAYER_READY" : "PLAYER_UNREADY";
      const e = await sign(t, { rulesHashSeen: lobby.rulesHash });
      await broadcast(e);
    },
    playCard: async (cardId: string, calledShape?: string) => {
      if (!game) throw new Error("Game not started");
      const hand = game.hands[o.identity.playerId] ?? [];
      const card = hand.find((c) => c.id === cardId);
      if (!card) throw new Error("Card not in hand");
      const e = await sign("PLAY_CARD", { card, calledShape });
      await broadcast(e);
    },
    drawCard: async () => {
      if (!game) throw new Error("Game not started");
      const top = game.drawPile[0];
      if (!top) throw new Error("Draw pile empty");
      const e = await sign("DRAW_CARD", { drawnCard: top });
      await broadcast(e);
    },
    declareLastCard: async () => {
      const e = await sign("DECLARE_LAST_CARD", {});
      await broadcast(e);
    },
    acceptPenalty: async () => {
      if (!game) throw new Error("Game not started");
      const pp = game.pendingPenalty;
      if (!pp) throw new Error("No pending penalty");
      const drawnCards = game.drawPile.slice(0, pp.count);
      const e = await sign("ACCEPT_PENALTY", { drawnCards });
      await broadcast(e);
    },
    leave: () => {
      clearInterval(pingInterval);
      mesh?.leave();
    },
    finality: () => log.all().map((e) => acks.status(e)),
    exportDisputeBundle: () =>
      buildDisputeBundle({
        gameId: o.gameId,
        rulesHash: lobby.rulesHash,
        rosterHash: hashCanonical(
          lobby.rosterLockedRoster ?? lobby.players.map((p) => p.playerId),
        ),
        events: log.all(),
        finalStateHash: game ? hashCanonical(game.outcome ?? null) : undefined,
        evidence,
      }),
  };
}

/**
 * Deterministic player order derived from gameId + sorted roster.
 */
export function derivePlayerOrder(gameId: string, roster: PlayerId[]): PlayerId[] {
  return roster
    .slice()
    .sort()
    .map((pid) => ({ pid, key: hashCanonical({ gameId, pid }) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((x) => x.pid);
}
