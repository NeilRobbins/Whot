/**
 * Lightweight in-memory diagnostic ring buffer + console fan-out.
 *
 * The goal is to make multi-browser P2P bugs reproducible and reportable
 * without a server-side log collector. Every interesting event is recorded
 * with a wall-clock timestamp, a category, a short message, and an optional
 * detail object. The buffer is exposed through `getDiagnostics()` so the UI
 * can render and download it as JSON.
 */

export type DiagLevel = "debug" | "info" | "warn" | "error";

export type DiagEntry = {
  t: number; // epoch ms
  level: DiagLevel;
  category: string;
  message: string;
  detail?: unknown;
};

const BUFFER_LIMIT = 500;
const buffer: DiagEntry[] = [];
const subscribers = new Set<(entries: readonly DiagEntry[]) => void>();

const consoleFn: Record<DiagLevel, (...args: unknown[]) => void> = {
  debug: (...a) => console.debug(...a),
  info: (...a) => console.info(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};

function record(entry: DiagEntry): void {
  buffer.push(entry);
  if (buffer.length > BUFFER_LIMIT) {
    buffer.splice(0, buffer.length - BUFFER_LIMIT);
  }
  consoleFn[entry.level](
    `[whot:${entry.category}] ${entry.message}`,
    entry.detail ?? "",
  );
  for (const fn of subscribers) fn(buffer);
}

export function diag(
  level: DiagLevel,
  category: string,
  message: string,
  detail?: unknown,
): void {
  record({ t: Date.now(), level, category, message, detail });
}

export const log = {
  debug: (cat: string, msg: string, detail?: unknown) => diag("debug", cat, msg, detail),
  info: (cat: string, msg: string, detail?: unknown) => diag("info", cat, msg, detail),
  warn: (cat: string, msg: string, detail?: unknown) => diag("warn", cat, msg, detail),
  error: (cat: string, msg: string, detail?: unknown) => diag("error", cat, msg, detail),
};

export function getDiagnostics(): readonly DiagEntry[] {
  return buffer;
}

export function subscribeDiagnostics(
  fn: (entries: readonly DiagEntry[]) => void,
): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function clearDiagnostics(): void {
  buffer.length = 0;
  for (const fn of subscribers) fn(buffer);
}

declare global {
  interface Window {
    __whotDiag?: {
      get: typeof getDiagnostics;
      clear: typeof clearDiagnostics;
      buffer: readonly DiagEntry[];
    };
  }
}

if (typeof window !== "undefined") {
  window.__whotDiag = {
    get: getDiagnostics,
    clear: clearDiagnostics,
    get buffer() {
      return buffer;
    },
  };
}
