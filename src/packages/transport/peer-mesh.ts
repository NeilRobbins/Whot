import { joinRoom, type Room } from "trystero/torrent";
import type { SignedEvent, PlayerId } from "@protocol-core/event-types";

export type WireMessage =
  | { kind: "EVENT"; event: SignedEvent }
  | { kind: "EVENT_BATCH"; events: SignedEvent[] }
  | { kind: "ACK"; eventHash: string }
  | { kind: "MISSING_EVENTS"; fromSequence: number }
  | { kind: "PING"; lastSeenEventHash: string }
  | { kind: "PONG"; lastSeenEventHash: string }
  | { kind: "HELLO"; playerId: PlayerId; displayName: string; publicKey: string }
  | { kind: "LOBBY_STATE"; players: Array<{ playerId: PlayerId; displayName: string; publicKey: string }>; ready: Record<PlayerId, boolean>; rosterLocked: boolean };

export type PeerMeshHandlers = {
  onPeerJoin?: (peerId: string) => void;
  onPeerLeave?: (peerId: string) => void;
  onMessage: (msg: WireMessage, fromPeerId: string) => void;
};

export type PeerMesh = {
  send: (msg: WireMessage) => void;
  sendTo: (peerId: string, msg: WireMessage) => void;
  peers: () => string[];
  leave: () => void;
};

const APP_ID = "whot-p2p-v1";

/**
 * Trystero uses public BitTorrent trackers as untrusted signalling. After
 * peer discovery WebRTC data channels carry all traffic. The signalling
 * service is completely untrusted — every message is independently signed.
 */
type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export function joinMesh(roomId: string, handlers: PeerMeshHandlers): PeerMesh {
  const room: Room = joinRoom({ appId: APP_ID }, roomId);
  // WireMessage is JSON-shaped at runtime; SignedEvent.payload is `unknown`
  // which is wider than trystero's JsonValue. Cast at the boundary.
  const [sendMsg, getMsg] = room.makeAction<Json>("msg");

  if (handlers.onPeerJoin) room.onPeerJoin(handlers.onPeerJoin);
  if (handlers.onPeerLeave) room.onPeerLeave(handlers.onPeerLeave);

  getMsg((data, peerId) => {
    handlers.onMessage(data as unknown as WireMessage, peerId);
  });

  return {
    send: (msg) => {
      sendMsg(msg as unknown as Json);
    },
    sendTo: (peerId, msg) => {
      sendMsg(msg as unknown as Json, peerId);
    },
    peers: () => Object.keys(room.getPeers()),
    leave: () => room.leave(),
  };
}
