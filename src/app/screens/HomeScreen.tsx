import { useEffect, useMemo, useState } from "react";
import { useApp } from "../store";
import { createHostSession, createGuestSession, type Session } from "../session";
import type { LobbyState } from "@lobby/lobby-state";
import type { WhotGameState } from "@whot-rules/state";
import type { SignedEvent } from "@protocol-core/event-types";

let activeSession: Session | undefined;
export function getSession(): Session | undefined {
  return activeSession;
}
export function setSession(s: Session | undefined): void {
  activeSession = s;
}

export function HomeScreen() {
  const displayName = useApp((s) => s.displayName);
  const setDisplayName = useApp((s) => s.setDisplayName);
  const identity = useApp((s) => s.identity);
  const setSessionFields = useApp((s) => s.setSession);
  const setLobby = useApp((s) => s.setLobby);
  const setGame = useApp((s) => s.setGame);
  const setMesh = useApp((s) => s.setMesh);
  const setScreen = useApp((s) => s.setScreen);
  const setError = useApp((s) => s.setError);
  const appendEvent = useApp((s) => s.appendEvent);
  const setPeerInfo = useApp((s) => s.setPeerInfo);
  const removePeer = useApp((s) => s.removePeer);
  const setFinality = useApp((s) => s.setFinality);

  const [busy, setBusy] = useState(false);

  const pending = useMemo(() => {
    const stash = sessionStorage.getItem("whot.pendingJoin");
    if (!stash) return undefined;
    const params = new URLSearchParams(stash);
    return {
      gameId: params.get("game") ?? "",
      roomId: params.get("room") ?? "",
      joinSecret: params.get("join") ?? "",
    };
  }, []);

  useEffect(() => {
    return () => {
      // intentionally no-op
    };
  }, []);

  const listeners = {
    onLobbyChange: (s: LobbyState) => setLobby(s),
    onGameChange: (s: WhotGameState | undefined) => {
      setGame(s);
      if (s && s.phase === "IN_PLAY") setScreen("GAME");
      if (s && s.phase === "ENDED") setScreen("RESULT");
    },
    onLogEvent: (e: SignedEvent) => appendEvent(e),
    onError: (m: string) => setError(m),
    onPeersChange: (peers: Record<string, { displayName?: string; playerId?: string; publicKey?: string }>) => {
      // Replace the entire peers map.
      const current = useApp.getState().peers;
      for (const id of Object.keys(current)) {
        if (!(id in peers)) removePeer(id);
      }
      for (const [id, info] of Object.entries(peers)) {
        setPeerInfo(id, info);
      }
    },
    onFinalityChange: (statuses: import("@game-log/ack-tracker").FinalityStatus[]) => {
      setFinality(statuses);
    },
  };

  async function host() {
    if (!identity) return;
    setBusy(true);
    setError(undefined);
    try {
      const s = await createHostSession({ identity, displayName, listeners });
      setSession(s);
      setMesh(s.mesh);
      const url = `${location.origin}${location.pathname}#game=${s.gameId}&room=${s.roomId}&join=${s.joinSecret}`;
      setSessionFields({
        role: "HOST",
        gameId: s.gameId,
        roomId: s.roomId,
        joinSecret: s.joinSecret,
        inviteUrl: url,
      });
      setLobby(s.lobby());
      setScreen("LOBBY");
    } catch (err) {
      setError(`Could not host: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function join(gameId: string, roomId: string, joinSecret: string) {
    if (!identity) return;
    setBusy(true);
    setError(undefined);
    try {
      const s = await createGuestSession({
        identity,
        displayName,
        listeners,
        gameId,
        roomId,
        joinSecret,
      });
      setSession(s);
      setMesh(s.mesh);
      const url = `${location.origin}${location.pathname}#game=${s.gameId}&room=${s.roomId}&join=${s.joinSecret}`;
      setSessionFields({
        role: "GUEST",
        gameId: s.gameId,
        roomId: s.roomId,
        joinSecret: s.joinSecret,
        inviteUrl: url,
      });
      setLobby(s.lobby());
      setScreen("LOBBY");
      sessionStorage.removeItem("whot.pendingJoin");
    } catch (err) {
      setError(`Could not join: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card-panel">
        <h2>Your Name</h2>
        <input
          className="input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={20}
          placeholder="What should others call you?"
          autoComplete="off"
        />
        <p className="muted">
          A unique signing key is generated in your browser per game session. No
          accounts, no servers.
        </p>
      </section>

      {pending ? (
        <section className="card-panel">
          <h2>Join Game</h2>
          <p>You were invited to game <strong>{pending.gameId.slice(0, 8)}…</strong></p>
          <button
            className="btn btn-primary"
            disabled={busy || !displayName.trim()}
            onClick={() => join(pending.gameId, pending.roomId, pending.joinSecret)}
          >
            {busy ? "Joining…" : "Join Lobby"}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              sessionStorage.removeItem("whot.pendingJoin");
              location.hash = "";
              location.reload();
            }}
          >
            Discard Invite
          </button>
        </section>
      ) : (
        <section className="card-panel">
          <h2>New Game</h2>
          <p className="muted">
            You'll be the host. Share the invite link with friends to fill the
            lobby. Up to 6 players.
          </p>
          <button
            className="btn btn-primary"
            disabled={busy || !displayName.trim()}
            onClick={host}
          >
            {busy ? "Setting up…" : "Host a Whot! Game"}
          </button>
        </section>
      )}

      <ManualJoinPanel onJoin={join} busy={busy} />

      <section className="card-panel">
        <h2>How it Works</h2>
        <ol className="muted" style={{ paddingLeft: "20px", lineHeight: 1.6 }}>
          <li>Host a game and copy the link.</li>
          <li>Share with players via WhatsApp, SMS, AirDrop, etc.</li>
          <li>Everyone hits Ready, host locks the roster.</li>
          <li>Cards deal automatically. First to empty their hand wins.</li>
        </ol>
      </section>
    </>
  );
}

function ManualJoinPanel({
  onJoin,
  busy,
}: {
  onJoin: (g: string, r: string, j: string) => void;
  busy: boolean;
}) {
  const [link, setLink] = useState("");
  function tryJoin() {
    try {
      const url = new URL(link);
      const params = new URLSearchParams(url.hash.replace(/^#/, ""));
      const game = params.get("game");
      const room = params.get("room");
      const join = params.get("join");
      if (!game || !room || !join) throw new Error("Invalid invite link");
      onJoin(game, room, join);
    } catch (err) {
      alert(`Invalid invite link: ${(err as Error).message}`);
    }
  }
  return (
    <section className="card-panel">
      <h2>Have an Invite Link?</h2>
      <input
        className="input"
        placeholder="Paste invite link"
        value={link}
        onChange={(e) => setLink(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <button className="btn" disabled={busy || !link} onClick={tryJoin}>
        Join via Link
      </button>
    </section>
  );
}
