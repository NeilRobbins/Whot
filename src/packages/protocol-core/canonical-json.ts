/**
 * Canonical JSON serialisation for stable hashing across clients.
 *
 * Rules:
 *  - Object keys sorted lexicographically.
 *  - No whitespace.
 *  - undefined values omitted.
 *  - NaN/Infinity rejected.
 *  - Strings escaped per JSON.stringify.
 */
export function canonicalJSON(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical-json: non-finite number");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) {
    return `[${value.map(stringify).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stringify(v)}`)
      .join(",")}}`;
  }
  throw new Error(`canonical-json: unsupported type ${typeof value}`);
}
