import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { canonicalJSON } from "@protocol-core/canonical-json";
import { hashHex } from "@protocol-core/hashing";
import type { BaseEvent, SignedEvent } from "@protocol-core/event-types";

export function eventHashOf<T extends string, P>(event: BaseEvent<T, P>): string {
  return hashHex(canonicalJSON(event));
}

export async function signEvent<T extends string, P>(
  event: BaseEvent<T, P>,
  privateKeyHex: string,
  publicKeyHex: string,
): Promise<SignedEvent<T, P>> {
  const eventHash = eventHashOf(event);
  const sig = await ed.signAsync(utf8ToBytes(eventHash), hexToBytes(privateKeyHex));
  return {
    ...event,
    eventHash,
    signature: bytesToHex(sig),
    publicKey: publicKeyHex,
  };
}

export async function verifyEvent<T extends string, P>(
  event: SignedEvent<T, P>,
): Promise<boolean> {
  const { eventHash, signature, publicKey, ...base } = event;
  const expectedHash = eventHashOf(base as BaseEvent<T, P>);
  if (expectedHash !== eventHash) return false;
  try {
    return await ed.verifyAsync(
      hexToBytes(signature),
      utf8ToBytes(eventHash),
      hexToBytes(publicKey),
    );
  } catch {
    return false;
  }
}
