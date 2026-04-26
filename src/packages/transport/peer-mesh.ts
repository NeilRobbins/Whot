import * as torrent from "trystero/torrent";
import * as nostr from "trystero/nostr";
import * as mqtt from "trystero/mqtt";
import type { Room } from "trystero";
import type { SignedEvent, PlayerId } from "@protocol-core/event-types";
import type { SignedAck } from "@trust-core/acks";
import { log } from "@protocol-core/diagnostics";

export type WireMessage =
  | { kind: "EVENT"; event: SignedEvent }
  | { kind: "EVENT_BATCH"; events: SignedEvent[] }
  | { kind: "ACK"; ack: SignedAck }
  | { kind: "MISSING_EVENTS"; fromSequence: number }
  | { kind: "PING"; lastSeenEventHash: string; tipSequence: number }
  | { kind: "PONG"; lastSeenEventHash: string; tipSequence: number }
  | { kind: "HELLO"; playerId: PlayerId; displayName: string; publicKey: string }
  | { kind: "LOBBY_STATE"; players: Array<{ playerId: PlayerId; displayName: string; publicKey: string }>; ready: Record<PlayerId, boolean>; rosterLocked: boolean };

export type StrategyName = "mqtt" | "nostr" | "torrent";

export type RelayState = {
  url: string;
  state: "connecting" | "open" | "closing" | "closed";
};

export type StrategyStatus = {
  name: StrategyName;
  selfPeerId: string;
  peerCount: number;
  peers: string[];
  relays: RelayState[];
  relaysConnected: number;
};

export type ConnectionStatus = {
  roomId: string;
  appId: string;
  strategies: StrategyStatus[];
  totalPeerCount: number;
};

export type PeerMeshHandlers = {
  onPeerJoin?: (peerId: string, strategy: StrategyName) => void;
  onPeerLeave?: (peerId: string, strategy: StrategyName) => void;
  onMessage: (msg: WireMessage, fromPeerId: string, strategy: StrategyName) => void;
  onStatus?: (status: ConnectionStatus) => void;
};

export type PeerMesh = {
  send: (msg: WireMessage) => void;
  sendTo: (peerId: string, msg: WireMessage) => void;
  peers: () => string[];
  status: () => ConnectionStatus;
  leave: () => void;
};

const APP_ID = "whot-p2p-v1";

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ],
};

const READY_STATE_LABEL: Record<number, RelayState["state"]> = {
  [WebSocket.CONNECTING]: "connecting",
  [WebSocket.OPEN]: "open",
  [WebSocket.CLOSING]: "closing",
  [WebSocket.CLOSED]: "closed",
};

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

type StrategyAdapter = {
  name: StrategyName;
  joinRoom: (config: Parameters<typeof mqtt.joinRoom>[0], roomId: string) => Room;
  getRelaySockets: () => Record<string, WebSocket>;
  selfId: string;
};

const ADAPTERS: StrategyAdapter[] = [
  // MQTT first — historically most reliable on permissive networks.
  {
    name: "mqtt",
    joinRoom: mqtt.joinRoom,
    getRelaySockets: mqtt.getRelaySockets,
    selfId: mqtt.selfId,
  },
  // Nostr next — uses port 443 wss://, often passes restrictive proxies that
  // block MQTT's non-standard ports.
  {
    name: "nostr",
    joinRoom: nostr.joinRoom,
    getRelaySockets: nostr.getRelaySockets,
    selfId: nostr.selfId,
  },
  // BitTorrent trackers as the last fallback.
  {
    name: "torrent",
    joinRoom: torrent.joinRoom,
    getRelaySockets: torrent.getRelaySockets,
    selfId: torrent.selfId,
  },
];

const NOSTR_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
  "wss://relay.nostr.band",
];

type StrategyHandle = {
  name: StrategyName;
  selfId: string;
  room: Room;
  send: (msg: Json, target?: string) => void;
  getRelaySockets: () => Record<string, WebSocket>;
  peerIds: () => string[];
  leave: () => void;
};

/**
 * Multi-strategy peer mesh: every Trystero signalling backend is started in
 * parallel and the application-layer messages are sent on whichever has open
 * channels. Each strategy has its own peer-id space, so the same logical
 * player may appear up to 3× in `room.getPeers()`. The signed event log
 * naturally deduplicates so this is harmless.
 *
 * Why three strategies? Different brokers/relays are blocked on different
 * networks (corporate firewalls, ISP filters, mobile carriers). Trying all
 * three in parallel maximises the chance that at least one bridges the two
 * peers. The first one to deliver a HELLO wins.
 */
export function joinMesh(roomId: string, handlers: PeerMeshHandlers): PeerMesh {
  log.info("transport", "joinMesh (multi-strategy)", {
    appId: APP_ID,
    roomId,
    strategies: ADAPTERS.map((a) => ({ name: a.name, selfId: a.selfId })),
  });

  const handles: StrategyHandle[] = ADAPTERS.map((a) => {
    const config: Parameters<typeof mqtt.joinRoom>[0] =
      a.name === "nostr"
        ? { appId: APP_ID, relayRedundancy: 3, relayUrls: NOSTR_RELAYS, rtcConfig: RTC_CONFIG }
        : { appId: APP_ID, relayRedundancy: 4, rtcConfig: RTC_CONFIG };
    let room: Room;
    try {
      room = a.joinRoom(config, roomId);
    } catch (err) {
      log.error("transport", `strategy ${a.name} init failed`, {
        error: (err as Error).message,
      });
      return null;
    }
    const [sendMsg, getMsg] = room.makeAction<Json>("msg");

    room.onPeerJoin((peerId) => {
      log.info("transport", `[${a.name}] peer joined`, {
        peerId,
        strategy: a.name,
      });
      handlers.onPeerJoin?.(peerId, a.name);
      pushStatus(`peer-join:${a.name}`);
    });
    room.onPeerLeave((peerId) => {
      log.info("transport", `[${a.name}] peer left`, {
        peerId,
        strategy: a.name,
      });
      handlers.onPeerLeave?.(peerId, a.name);
      pushStatus(`peer-leave:${a.name}`);
    });
    getMsg((data, peerId) => {
      const msg = data as unknown as WireMessage;
      log.debug("transport", `[${a.name}] recv ${msg.kind}`, { fromPeerId: peerId });
      handlers.onMessage(msg, peerId, a.name);
    });

    return {
      name: a.name,
      selfId: a.selfId,
      room,
      send: (msg: Json, target?: string) => {
        if (target) void sendMsg(msg, target);
        else void sendMsg(msg);
      },
      getRelaySockets: a.getRelaySockets,
      peerIds: () => Object.keys(room.getPeers()),
      leave: () => {
        try {
          void room.leave();
        } catch {
          /* ignore */
        }
      },
    };
  }).filter((h): h is StrategyHandle => h !== null);

  function relayStatesFor(handle: StrategyHandle): RelayState[] {
    try {
      const sockets = handle.getRelaySockets();
      return Object.entries(sockets).map(([url, ws]) => ({
        url,
        state: READY_STATE_LABEL[ws.readyState] ?? "closed",
      }));
    } catch {
      return [];
    }
  }

  function status(): ConnectionStatus {
    const strategies: StrategyStatus[] = handles.map((h) => {
      const relays = relayStatesFor(h);
      const peers = h.peerIds();
      return {
        name: h.name,
        selfPeerId: h.selfId,
        peerCount: peers.length,
        peers,
        relays,
        relaysConnected: relays.filter((r) => r.state === "open").length,
      };
    });
    const totalPeerCount = strategies.reduce((acc, s) => acc + s.peerCount, 0);
    return { roomId, appId: APP_ID, strategies, totalPeerCount };
  }

  let lastStatusJson = "";
  function pushStatus(reason: string): void {
    const s = status();
    const j = JSON.stringify(s);
    if (j === lastStatusJson) return;
    lastStatusJson = j;
    log.debug("transport", `status update (${reason})`, s);
    handlers.onStatus?.(s);
  }

  const initialDelay = setTimeout(() => pushStatus("init"), 250);
  const statusTimer = setInterval(() => pushStatus("interval"), 2000);

  /**
   * Map peerId → which strategy handles it. Used by sendTo to send only on
   * the strategy that owns that peer.
   */
  function findOwnerOf(peerId: string): StrategyHandle | undefined {
    return handles.find((h) => h.peerIds().includes(peerId));
  }

  return {
    send: (msg) => {
      const json = msg as unknown as Json;
      let totalRecipients = 0;
      for (const h of handles) {
        const peers = h.peerIds();
        if (peers.length === 0) continue;
        totalRecipients += peers.length;
        try {
          h.send(json);
        } catch (err) {
          log.warn("transport", `[${h.name}] send failed`, {
            error: (err as Error).message,
          });
        }
      }
      log.debug("transport", `send ${msg.kind}`, { totalRecipients });
    },
    sendTo: (peerId, msg) => {
      const owner = findOwnerOf(peerId);
      if (!owner) {
        log.warn("transport", `sendTo: no strategy owns peer ${peerId}`);
        return;
      }
      log.debug("transport", `[${owner.name}] sendTo ${msg.kind}`, { peerId });
      try {
        owner.send(msg as unknown as Json, peerId);
      } catch (err) {
        log.warn("transport", `[${owner.name}] sendTo failed`, {
          error: (err as Error).message,
        });
      }
    },
    peers: () => {
      // Union of all strategies' peers (with possible duplicates if same
      // browser connected via multiple strategies — application doesn't care).
      const set = new Set<string>();
      for (const h of handles) for (const p of h.peerIds()) set.add(p);
      return [...set];
    },
    status,
    leave: () => {
      log.info("transport", "leave");
      clearTimeout(initialDelay);
      clearInterval(statusTimer);
      for (const h of handles) h.leave();
    },
  };
}
