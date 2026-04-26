import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import type { PlayerId } from "@protocol-core/event-types";

export type SignedAck = {
  eventHash: string;
  signerPlayerId: PlayerId;
  signerPublicKey: string;
  signature: string;
};

const ACK_PREFIX = "whot-ack:v1:";

export async function signAck(
  eventHash: string,
  signerPlayerId: PlayerId,
  privateKeyHex: string,
  publicKeyHex: string,
): Promise<SignedAck> {
  const sig = await ed.signAsync(
    utf8ToBytes(ACK_PREFIX + eventHash),
    hexToBytes(privateKeyHex),
  );
  return {
    eventHash,
    signerPlayerId,
    signerPublicKey: publicKeyHex,
    signature: bytesToHex(sig),
  };
}

export async function verifyAck(ack: SignedAck): Promise<boolean> {
  try {
    return await ed.verifyAsync(
      hexToBytes(ack.signature),
      utf8ToBytes(ACK_PREFIX + ack.eventHash),
      hexToBytes(ack.signerPublicKey),
    );
  } catch {
    return false;
  }
}
