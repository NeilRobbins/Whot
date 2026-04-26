import { joinRoom, getRelaySockets, type Room } from "trystero/nostr";
import type { SignedEvent, PlayerId } from "@protocol-core/event-types";
import type { SignedAck } from "@trust-core/acks";

export type WireMessage =
  | { kind: "EVENT"; event: SignedEvent }
  | { kind: "EVENT_BATCH"; events: SignedEvent[] }
  | { kind: "ACK"; ack: SignedAck }
  | { kind: "MISSING_EVENTS"; fromSequence: number }
  | { kind: "PING"; lastSeenEventHash: string; tipSequence: number }
  | { kind: "PONG"; lastSeenEventHash: string; tipSequence: number }
  | { kind: "HELLO"; playerId: PlayerId; displayName: string; publicKey: string }
  | { kind: "LOBBY_STATE"; players: Array<{ playerId: PlayerId; displayName: string; publicKey: string }>; ready: Record<PlayerId, boolean>; rosterLocked: boolean };

export type ConnectionStatus = {
  relaysConnected: number;
  relaysTotal: number;
  peerCount: number;
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
 * Public Nostr relays. Trystero uses these as untrusted signalling — once
 * peers find each other, every byte travels over end-to-end-encrypted WebRTC
 * data channels. We list multiple relays so that a single relay outage does
 * not break peer discovery.
 */
const RELAY_URLS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
  "wss://relay.nostr.band",
  "wss://nostr.wine",
];

/**
 * STUN servers help discover the public-IP/port pair for direct WebRTC
 * connections. TURN relays carry the data channel when direct connections
 * are blocked by symmetric NATs / restrictive firewalls.
 *
 * Public TURN servers are best-effort. If both peers are on networks that
 * actively block UDP, even TURN may not save them — that's a fundamental
 * limitation of public-internet WebRTC without dedicated infrastructure.
 */
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ],
};

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export function joinMesh(roomId: string, handlers: PeerMeshHandlers): PeerMesh {
  const room: Room = joinRoom(
    {
      appId: APP_ID,
      relayUrls: RELAY_URLS,
      relayRedundancy: 3,
      rtcConfig: RTC_CONFIG,
    },
    roomId,
  );
  // WireMessage is JSON-shaped at runtime; SignedEvent.payload is `unknown`
  // which is wider than trystero's JsonValue. Cast at the boundary.
  const [sendMsg, getMsg] = room.makeAction<Json>("msg");

  if (handlers.onPeerJoin) {
    room.onPeerJoin((peerId) => {
      handlers.onPeerJoin!(peerId);
      pushStatus();
    });
  }
  if (handlers.onPeerLeave) {
    room.onPeerLeave((peerId) => {
      handlers.onPeerLeave!(peerId);
      pushStatus();
    });
  }

  getMsg((data, peerId) => {
    handlers.onMessage(data as unknown as WireMessage, peerId);
  });

  function status(): ConnectionStatus {
    const sockets = getRelaySockets();
    const entries = Object.values(sockets);
    const open = entries.filter((s) => s.readyState === WebSocket.OPEN).length;
    return {
      relaysConnected: open,
      relaysTotal: entries.length || RELAY_URLS.length,
      peerCount: Object.keys(room.getPeers()).length,
    };
  }

  function pushStatus(): void {
    handlers.onStatus?.(status());
  }

  // Push status periodically so the UI can show "connecting…" feedback.
  const statusTimer = setInterval(pushStatus, 2000);
  // First push on next tick so callers can subscribe before it fires.
  queueMicrotask(pushStatus);

  return {
    send: (msg) => {
      sendMsg(msg as unknown as Json);
    },
    sendTo: (peerId, msg) => {
      sendMsg(msg as unknown as Json, peerId);
    },
    peers: () => Object.keys(room.getPeers()),
    status,
    leave: () => {
      clearInterval(statusTimer);
      void room.leave();
    },
  };
}
