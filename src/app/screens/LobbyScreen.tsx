import { useEffect, useState } from "react";
import { useApp } from "../store";
import { getSession } from "./HomeScreen";
import type { Player } from "@protocol-core/event-types";
import { DebugPanel } from "../components/DebugPanel";

export function LobbyScreen() {
  const lobby = useApp((s) => s.lobby);
  const role = useApp((s) => s.role);
  const inviteUrl = useApp((s) => s.inviteUrl);
  const identity = useApp((s) => s.identity);
  const setError = useApp((s) => s.setError);
  const events = useApp((s) => s.log);
  const connection = useApp((s) => s.connection);
  const [copied, setCopied] = useState(false);

  // Auto-admit join requests if host.
  useEffect(() => {
    if (role !== "HOST") return;
    const session = getSession();
    if (!session) return;
    const seen = new Set<string>();
    for (const e of events) {
      if (e.type === "PLAYER_JOIN_REQUESTED") {
        const player = (e.payload as { player: Player }).player;
        if (seen.has(player.playerId)) continue;
        seen.add(player.playerId);
        const already = lobby?.players.some((p) => p.playerId === player.playerId);
        if (!already) {
          session.admitPlayer(player).catch((err) => setError(err.message));
        }
      }
    }
  }, [events, role, lobby, setError]);

  if (!lobby || !identity) {
    return (
      <>
        <div className="center-message">
          <div className="spinner" /> Connecting to peers…
          <ConnectionStatusLine connection={connection} />
        </div>
        <DebugPanel />
      </>
    );
  }

  const me = identity.playerId;
  const myReady = !!lobby.ready[me];
  const allReady =
    lobby.players.length >= 2 &&
    lobby.players.every((p) => lobby.ready[p.playerId]);

  async function copyLink() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text input
      window.prompt("Copy invite link", inviteUrl);
    }
  }

  async function shareLink() {
    if (!inviteUrl) return;
    const text = "Join my Whot! game";
    if (navigator.share) {
      try {
        await navigator.share({ title: "Whot!", text, url: inviteUrl });
        return;
      } catch {
        // user cancelled; fall back to copy.
      }
    }
    copyLink();
  }

  async function toggleReady() {
    const s = getSession();
    if (!s) return;
    try {
      await s.setReady(!myReady);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function lock() {
    const s = getSession();
    if (!s) return;
    try {
      await s.lockRoster();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function kick(playerId: string) {
    const s = getSession();
    if (!s) return;
    try {
      await s.removePlayer(playerId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const showShare = role === "HOST" && !!inviteUrl;

  return (
    <>
      {showShare && (
        <section className="card-panel">
          <h2>Invite Players</h2>
          <div className="copyable">
            <input className="input" readOnly value={inviteUrl} />
            <button className="btn" onClick={copyLink}>
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button className="btn btn-primary" onClick={shareLink}>
            Share Invite
          </button>
          <p className="muted">
            Anyone with this link can join. The host (you) controls who is
            admitted; admission happens automatically here for simplicity.
          </p>
        </section>
      )}

      <section className="card-panel">
        <h2>Lobby</h2>
        {lobby.players.length === 0 ? (
          <div className="center-message">
            <div className="spinner" /> Waiting to connect to host…
            <ConnectionStatusLine connection={connection} />
          </div>
        ) : (
          lobby.players.map((p) => (
            <div className="player-row" key={p.playerId}>
              <div>
                <span
                  className={`dot ${lobby.ready[p.playerId] ? "ready" : "notready"}`}
                />
                <span className="name">{p.displayName}</span>{" "}
                {p.role === "HOST" && <span className="tag">HOST</span>}{" "}
                {p.playerId === me && <span className="tag">YOU</span>}
              </div>
              {role === "HOST" && p.playerId !== me && (
                <button
                  className="btn btn-ghost"
                  style={{ width: "auto", minHeight: "36px", padding: "6px 12px" }}
                  onClick={() => kick(p.playerId)}
                >
                  Remove
                </button>
              )}
            </div>
          ))
        )}
      </section>

      <section className="card-panel">
        <button className="btn btn-primary" onClick={toggleReady}>
          {myReady ? "Cancel Ready" : "I'm Ready"}
        </button>
        {role === "HOST" && (
          <button
            className="btn"
            disabled={!allReady}
            onClick={lock}
            title={allReady ? "" : "Need 2+ players, all ready"}
          >
            Lock Roster & Start
          </button>
        )}
        {role !== "HOST" && (
          <p className="muted center-text">
            Waiting for the host to start the game…
          </p>
        )}
        <ConnectionStatusLine connection={connection} />
      </section>

      <DebugPanel />
    </>
  );
}

function ConnectionStatusLine({
  connection,
}: {
  connection?: import("@transport/peer-mesh").ConnectionStatus;
}) {
  if (!connection) {
    return (
      <p className="muted center-text" style={{ fontSize: 12, marginTop: 8 }}>
        Initialising…
      </p>
    );
  }
  const totalRelaysConnected = connection.strategies.reduce(
    (acc, s) => acc + s.relaysConnected,
    0,
  );
  const totalRelays = connection.strategies.reduce(
    (acc, s) => acc + s.relays.length,
    0,
  );
  const peerCount = connection.totalPeerCount;
  const perStrategy = connection.strategies
    .map((s) => `${s.name}:${s.relaysConnected}/${s.relays.length}r,${s.peerCount}p`)
    .join(" · ");
  const relayLine =
    totalRelaysConnected === 0
      ? "Connecting to signalling relays…"
      : `${totalRelaysConnected}/${totalRelays} signalling relays connected`;
  const peerLine =
    peerCount === 0
      ? "Searching for peers across all strategies…"
      : `${peerCount} peer${peerCount === 1 ? "" : "s"} connected`;
  return (
    <p
      className="muted center-text"
      style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}
    >
      {relayLine}
      <br />
      {peerLine}
      <br />
      <span style={{ fontSize: 10, opacity: 0.6 }}>{perStrategy}</span>
    </p>
  );
}
