import { useEffect, useState } from "react";
import {
  type DiagEntry,
  getDiagnostics,
  subscribeDiagnostics,
} from "@protocol-core/diagnostics";
import { BUILD_ID, BUILD_TIME } from "@protocol-core/build-info";
import { useApp } from "../store";

const LEVEL_COLOUR: Record<DiagEntry["level"], string> = {
  debug: "var(--fg-3)",
  info: "var(--fg-2)",
  warn: "var(--warn)",
  error: "var(--danger)",
};

export function DebugPanel() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<readonly DiagEntry[]>(getDiagnostics());
  const connection = useApp((s) => s.connection);
  const identity = useApp((s) => s.identity);
  const lobby = useApp((s) => s.lobby);
  const game = useApp((s) => s.game);
  const events = useApp((s) => s.log);
  const finality = useApp((s) => s.finality);

  useEffect(() => {
    return subscribeDiagnostics((latest) => {
      // Re-create slice to trigger render.
      setEntries(latest.slice());
    });
  }, []);

  function exportSnapshot() {
    const snapshot = {
      build: { id: BUILD_ID, time: BUILD_TIME, userAgent: navigator.userAgent },
      identity: identity
        ? { playerId: identity.playerId, publicKey: identity.publicKey }
        : null,
      lobby,
      game,
      connection,
      finality,
      events,
      diagnostics: entries,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `whot-debug-${BUILD_ID.slice(0, 8)}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!open) {
    return (
      <button
        className="btn btn-ghost"
        style={{ width: "auto", alignSelf: "center", padding: "8px 14px", minHeight: "auto" }}
        onClick={() => setOpen(true)}
      >
        Show debug info
      </button>
    );
  }

  return (
    <section className="card-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Debug</h2>
        <button
          className="btn btn-ghost"
          style={{ width: "auto", padding: "6px 12px", minHeight: "auto" }}
          onClick={() => setOpen(false)}
        >
          Hide
        </button>
      </div>

      <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
        <div>build: <code>{BUILD_ID.slice(0, 12)}</code> · {BUILD_TIME}</div>
        <div>player: <code>{identity?.playerId ?? "-"}</code></div>
        <div>UA: <code>{navigator.userAgent}</code></div>
        {connection && (
          <>
            <div>strategy: <code>{connection.strategy}</code></div>
            <div>self peer: <code>{connection.selfPeerId ?? "—"}</code></div>
            <div>room: <code>{connection.roomId.slice(0, 12)}</code> · app: <code>{connection.appId}</code></div>
            <div>peers ({connection.peerCount}): <code>{connection.peers.join(", ") || "—"}</code></div>
            <div style={{ marginTop: 6 }}><strong>relays:</strong></div>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {connection.relays.map((r) => (
                <li key={r.url}>
                  <code style={{ color: r.state === "open" ? "var(--accent-2)" : "var(--warn)" }}>
                    {r.state}
                  </code>{" "}
                  {r.url}
                </li>
              ))}
            </ul>
          </>
        )}
        <div style={{ marginTop: 6 }}>events: {events.length} · finality: {finality.filter((f) => f.final).length}/{finality.length}</div>
      </div>

      <button className="btn" onClick={exportSnapshot}>
        Export Debug Snapshot (JSON)
      </button>

      <div className="transcript" style={{ maxHeight: 260 }}>
        {entries.slice(-200).map((e, i) => (
          <div className="ev" key={i}>
            <span className="seq">
              {new Date(e.t).toISOString().slice(11, 23)}
            </span>
            <span style={{ color: LEVEL_COLOUR[e.level], width: 50 }}>
              {e.level}
            </span>
            <span className="type">{e.category}</span>
            <span style={{ flex: 1 }}>{e.message}</span>
            {e.detail !== undefined && (
              <span className="seq" style={{ marginLeft: 6 }}>
                {summariseDetail(e.detail)}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function summariseDetail(detail: unknown): string {
  if (detail === undefined || detail === null) return "";
  try {
    const json = JSON.stringify(detail);
    return json.length > 80 ? json.slice(0, 77) + "…" : json;
  } catch {
    return String(detail);
  }
}
