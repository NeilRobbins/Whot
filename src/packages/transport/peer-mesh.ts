import { joinRoom, getRelaySockets, selfId, type Room } from "trystero/mqtt";
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

export type RelayState = {
  url: string;
  state: "connecting" | "open" | "closing" | "closed";
};

export type ConnectionStatus = {
  strategy: "mqtt";
  relays: RelayState[];
  relaysConnected: number;
  relaysTotal: number;
  peerCount: number;
  peers: string[];
  selfPeerId?: string;
  roomId: string;
  appId: string;
};

export type PeerMeshHandlers = {
  onPeerJoin?: (peerId: string) => void;
  onPeerLeave?: (peerId: string) => void;
  onMessage: (msg: WireMessage, fromPeerId: string) => void;
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

/**
 * STUN servers help discover the public-IP/port pair for direct WebRTC
 * connections. TURN relays carry the data channel when direct connections
 * are blocked by symmetric NATs / restrictive firewalls.
 *
 * We do not currently provision a TURN server. If two peers are both behind
 * symmetric NATs that deny UDP, even relayable signalling will not save them.
 */
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

export function joinMesh(roomId: string, handlers: PeerMeshHandlers): PeerMesh {
  log.info("transport", "joinMesh", {
    strategy: "mqtt",
    appId: APP_ID,
    roomId,
    selfPeerId: selfId,
  });

  const room: Room = joinRoom(
    {
      appId: APP_ID,
      relayRedundancy: 4,
      rtcConfig: RTC_CONFIG,
    },
    roomId,
  );
  const [sendMsg, getMsg] = room.makeAction<Json>("msg");

  room.onPeerJoin((peerId) => {
    log.info("transport", "peer joined", { peerId, peerCount: Object.keys(room.getPeers()).length });
    handlers.onPeerJoin?.(peerId);
    pushStatus("peer-join");
  });
  room.onPeerLeave((peerId) => {
    log.info("transport", "peer left", { peerId, peerCount: Object.keys(room.getPeers()).length });
    handlers.onPeerLeave?.(peerId);
    pushStatus("peer-leave");
  });

  getMsg((data, peerId) => {
    const msg = data as unknown as WireMessage;
    log.debug("transport", `recv ${msg.kind}`, { fromPeerId: peerId });
    handlers.onMessage(msg, peerId);
  });

  function relayStates(): RelayState[] {
    const sockets = getRelaySockets();
    return Object.entries(sockets).map(([url, ws]) => ({
      url,
      state: READY_STATE_LABEL[ws.readyState] ?? "closed",
    }));
  }

  function status(): ConnectionStatus {
    const relays = relayStates();
    const peerIds = Object.keys(room.getPeers());
    return {
      strategy: "mqtt",
      relays,
      relaysConnected: relays.filter((r) => r.state === "open").length,
      relaysTotal: relays.length,
      peerCount: peerIds.length,
      peers: peerIds,
      selfPeerId: selfId,
      roomId,
      appId: APP_ID,
    };
  }

  let lastStatusJson = "";
  function pushStatus(reason: string): void {
    const s = status();
    const j = JSON.stringify(s);
    if (j === lastStatusJson) return; // de-dupe
    lastStatusJson = j;
    log.debug("transport", `status update (${reason})`, s);
    handlers.onStatus?.(s);
  }

  // Push first status soon after construction, then on a low-frequency timer
  // so the relay-connection state propagates without spamming.
  const initialDelay = setTimeout(() => pushStatus("init"), 250);
  const statusTimer = setInterval(() => pushStatus("interval"), 2000);

  return {
    send: (msg) => {
      log.debug("transport", `send ${msg.kind}`, { peerCount: Object.keys(room.getPeers()).length });
      void sendMsg(msg as unknown as Json);
    },
    sendTo: (peerId, msg) => {
      log.debug("transport", `sendTo ${msg.kind}`, { peerId });
      void sendMsg(msg as unknown as Json, peerId);
    },
    peers: () => Object.keys(room.getPeers()),
    status,
    leave: () => {
      log.info("transport", "leave");
      clearTimeout(initialDelay);
      clearInterval(statusTimer);
      void room.leave();
    },
  };
}
