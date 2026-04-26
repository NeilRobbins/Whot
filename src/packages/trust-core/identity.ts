import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { hashHex } from "@protocol-core/hashing";

// Provide sync sha512 so sync paths work too. Async API works without it.
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

export type PlayerIdentity = {
  playerId: string;
  publicKey: string;
  privateKey: string;
};

function randomPrivateKeyHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function generateIdentity(): Promise<PlayerIdentity> {
  const privateKey = randomPrivateKeyHex();
  const publicKey = bytesToHex(await ed.getPublicKeyAsync(hexToBytes(privateKey)));
  const playerId = hashHex(publicKey).slice(0, 16);
  return { playerId, publicKey, privateKey };
}

export async function publicKeyFromPrivate(privateKeyHex: string): Promise<string> {
  return bytesToHex(await ed.getPublicKeyAsync(hexToBytes(privateKeyHex)));
}

export function playerIdFromPublicKey(publicKey: string): string {
  return hashHex(publicKey).slice(0, 16);
}
