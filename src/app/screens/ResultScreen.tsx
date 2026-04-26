import { useApp } from "../store";
import { summariseOutcome } from "@endgame/index";
import { getSession, setSession } from "./HomeScreen";

export function ResultScreen() {
  const game = useApp((s) => s.game);
  const lobby = useApp((s) => s.lobby);
  const reset = useApp((s) => s.reset);
  const events = useApp((s) => s.log);

  if (!game || !lobby) return null;
  const names: Record<string, string> = {};
  for (const p of lobby.players) names[p.playerId] = p.displayName;

  const summary = game.outcome
    ? summariseOutcome(game.outcome, names)
    : "Game ended.";

  function leave() {
    const s = getSession();
    s?.leave();
    setSession(undefined);
    reset();
    location.hash = "";
  }

  function exportTranscript() {
    const blob = new Blob([JSON.stringify(events, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `whot-transcript-${game!.rulesHash.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const finalScores =
    game.outcome && "finalScores" in game.outcome ? game.outcome.finalScores : undefined;

  return (
    <>
      <section className="card-panel">
        <h2>Game Over</h2>
        <div style={{ fontSize: 26, fontWeight: 700, textAlign: "center", padding: "12px 0" }}>
          {summary}
        </div>
        {finalScores && (
          <div>
            {Object.entries(finalScores)
              .sort((a, b) => a[1] - b[1])
              .map(([pid, score]) => (
                <div className="player-row" key={pid}>
                  <span className="name">{names[pid] ?? pid.slice(0, 6)}</span>
                  <span className="muted">
                    {score === 0 ? "Out" : `${score} pts left`}
                  </span>
                </div>
              ))}
          </div>
        )}
      </section>

      <section className="card-panel">
        <button className="btn btn-primary" onClick={leave}>
          Back to Home
        </button>
        <button className="btn" onClick={exportTranscript}>
          Export Transcript ({events.length} events)
        </button>
      </section>

      <section className="card-panel">
        <h2>Audit Log</h2>
        <div className="transcript">
          {events.map((e) => (
            <div className="ev" key={e.eventHash}>
              <span className="seq">#{e.sequence}</span>
              <span className="type">{e.type}</span>
              <span>{names[e.actor] ?? e.actor.slice(0, 6)}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
