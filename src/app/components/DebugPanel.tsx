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

  const [exportText, setExportText] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  function buildSnapshot(): string {
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
    return JSON.stringify(snapshot, null, 2);
  }

  async function exportSnapshot() {
    const json = buildSnapshot();
    const filename = `whot-debug-${BUILD_ID.slice(0, 8)}-${Date.now()}.json`;
    setExportNote(null);

    // 1. Try Web Share API with a File (works on iOS Safari → Share Sheet,
    // letting users save to Files / AirDrop / Mail / Messages).
    try {
      const file = new File([json], filename, { type: "application/json" });
      const nav = navigator as Navigator & {
        canShare?: (data: { files?: File[] }) => boolean;
      };
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Whot debug snapshot" });
        setExportNote("Shared via system share sheet.");
        return;
      }
    } catch (err) {
      // user may have cancelled; fall through to clipboard.
      const reason = (err as Error).message;
      if (!/abort|cancel/i.test(reason)) {
        setExportNote(`Share failed: ${reason}. Trying clipboard…`);
      }
    }

    // 2. Try clipboard.
    try {
      await navigator.clipboard.writeText(json);
      setExportNote(`Copied ${json.length.toLocaleString()} chars to clipboard.`);
      setExportText(json);
      return;
    } catch {
      // fall through
    }

    // 3. Fall back to anchor-download (desktop browsers).
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setExportNote("Downloaded.");
      return;
    } catch {
      /* fall through */
    }

    // 4. Last resort: show inline so the user can long-press → select all.
    setExportText(json);
    setExportNote(
      "Could not share or download. Tap the box below, long-press to Select All, then Copy.",
    );
  }

  async function copyToClipboard() {
    const json = buildSnapshot();
    try {
      await navigator.clipboard.writeText(json);
      setExportNote(`Copied ${json.length.toLocaleString()} chars to clipboard.`);
      setExportText(null);
    } catch {
      setExportText(json);
      setExportNote("Clipboard blocked. Long-press the textarea below to select & copy.");
    }
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
            <div>room: <code>{connection.roomId.slice(0, 12)}</code> · app: <code>{connection.appId}</code></div>
            <div>total peers: <strong>{connection.totalPeerCount}</strong></div>
            {connection.strategies.map((strat) => (
              <div
                key={strat.name}
                style={{
                  marginTop: 8,
                  paddingLeft: 8,
                  borderLeft: `2px solid ${
                    strat.peerCount > 0
                      ? "var(--accent-2)"
                      : strat.relaysConnected > 0
                        ? "var(--warn)"
                        : "var(--danger)"
                  }`,
                }}
              >
                <div>
                  <strong style={{ color: "var(--fg-1)" }}>{strat.name}</strong>{" "}
                  · self <code>{strat.selfPeerId.slice(0, 8)}</code>
                  {" "}· peers ({strat.peerCount}):{" "}
                  <code>
                    {strat.peers.map((p) => p.slice(0, 8)).join(", ") || "—"}
                  </code>
                </div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {strat.relays.map((r) => (
                    <li key={r.url}>
                      <code
                        style={{
                          color: r.state === "open" ? "var(--accent-2)" : "var(--warn)",
                        }}
                      >
                        {r.state}
                      </code>{" "}
                      {r.url}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
        <div style={{ marginTop: 6 }}>events: {events.length} · finality: {finality.filter((f) => f.final).length}/{finality.length}</div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" onClick={exportSnapshot} style={{ flex: 1 }}>
          Share / Save Snapshot
        </button>
        <button
          className="btn btn-ghost"
          onClick={copyToClipboard}
          style={{ flex: 1 }}
        >
          Copy to Clipboard
        </button>
      </div>

      {exportNote && (
        <p className="muted" style={{ fontSize: 12 }}>
          {exportNote}
        </p>
      )}

      {exportText && (
        <textarea
          readOnly
          value={exportText}
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          style={{
            width: "100%",
            minHeight: 160,
            background: "var(--bg-1)",
            color: "var(--fg-2)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 8,
            padding: 8,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 11,
            lineHeight: 1.4,
            resize: "vertical",
          }}
        />
      )}

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
