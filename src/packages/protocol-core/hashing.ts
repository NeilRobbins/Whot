import { sha256 } from "@noble/hashes/sha2";
import { hmac } from "@noble/hashes/hmac";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { canonicalJSON } from "./canonical-json";

export function hashHex(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? utf8ToBytes(input) : input;
  return bytesToHex(sha256(bytes));
}

export function hashCanonical(value: unknown): string {
  return hashHex(canonicalJSON(value));
}

export function hmacHex(key: string, message: string): string {
  const tag = hmac(sha256, utf8ToBytes(key), utf8ToBytes(message));
  return bytesToHex(tag);
}

export const ZERO_HASH = "0".repeat(64);
