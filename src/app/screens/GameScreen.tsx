import { useMemo } from "react";
import { useApp } from "../store";
import { getSession } from "./HomeScreen";
import { CardBack, CardView } from "../components/CardView";
import { activeMatchShape, currentPlayer, topDiscard } from "@whot-rules/state";
import { validatePlay } from "@whot-rules/validator";
import type { Shape } from "@whot-rules/deck";

export function GameScreen() {
  const game = useApp((s) => s.game);
  const lobby = useApp((s) => s.lobby);
  const identity = useApp((s) => s.identity);
  const setError = useApp((s) => s.setError);
  const selectedCardId = useApp((s) => s.selectedCardId);
  const setSelectedCard = useApp((s) => s.setSelectedCard);
  const whotPicker = useApp((s) => s.whotShapePicker);
  const setWhotPicker = useApp((s) => s.setWhotShapePicker);
  const tabHidden = useApp((s) => s.tabHidden);

  const me = identity?.playerId ?? "";
  const myHand = useMemo(() => game?.hands[me] ?? [], [game, me]);
  const isMyTurn = !!game && currentPlayer(game) === me;
  const top = game ? topDiscard(game) : undefined;
  const calledShape = game ? activeMatchShape(game) : undefined;

  if (!game || !lobby || !identity) {
    return (
      <div className="center-message">
        <div className="spinner" /> Dealing the cards…
      </div>
    );
  }

  const session = getSession();

  const opponents = game.playerOrder.filter((p) => p !== me);
  function nameOf(id: string): string {
    return lobby!.players.find((p) => p.playerId === id)?.displayName ?? id.slice(0, 6);
  }

  async function selectCard(cardId: string) {
    if (!isMyTurn) return;
    if (selectedCardId === cardId) {
      // Confirm play.
      await playSelected();
      return;
    }
    setSelectedCard(cardId);
  }

  async function playSelected(forceShape?: Shape) {
    if (!session || !game) return;
    const cardId = forceShape ? whotPicker?.cardId : selectedCardId;
    if (!cardId) return;
    const card = (game.hands[me] ?? []).find((c) => c.id === cardId);
    if (!card) return;
    let shape = forceShape;
    if (card.shape === "whot" && !shape) {
      setWhotPicker({ cardId });
      return;
    }
    const v = validatePlay(game, me, card, shape);
    if (!v.ok) {
      setError(v.reason);
      return;
    }
    try {
      await session.playCard(card.id, shape);
      setSelectedCard(undefined);
      setWhotPicker(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function drawCard() {
    if (!session) return;
    try {
      await session.drawCard();
      setSelectedCard(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function declareLast() {
    if (!session) return;
    try {
      await session.declareLastCard();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function acceptPenalty() {
    if (!session) return;
    try {
      await session.acceptPenalty();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="table">
      {tabHidden && (
        <div
          className="banner"
          style={{ background: "var(--warn)", color: "#0b1220" }}
        >
          Tab in background — iOS will drop your connection. Return soon.
        </div>
      )}
      <div className="opponents">
        {opponents.map((pid) => {
          const isCurrent = currentPlayer(game) === pid;
          const handCount = (game.hands[pid] ?? []).length;
          return (
            <div className={`opponent${isCurrent ? " current" : ""}`} key={pid}>
              <div className="name">{nameOf(pid)}</div>
              <div className="meta">{handCount} card{handCount === 1 ? "" : "s"}</div>
              {game.lastCardDeclared[pid] && (
                <div className="meta" style={{ color: "var(--warn)" }}>
                  Last Card!
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="center">
        <div className="deck-pile" onClick={isMyTurn ? drawCard : undefined}>
          <CardBack />
          <div className="count">Draw · {game.drawPile.length}</div>
        </div>
        {top && (
          <div style={{ position: "relative" }}>
            <CardView card={top} large />
            <div className="count" style={{ position: "absolute", bottom: -22, width: "100%", textAlign: "center", color: "var(--fg-3)", fontSize: 12 }}>
              {calledShape && top.shape === "whot"
                ? `Called: ${calledShape}`
                : `Top · ${game.discardPile.length}`}
            </div>
          </div>
        )}
      </div>

      {game.pendingPenalty && (
        <div className="banner" style={{ background: "var(--warn)", color: "#0b1220" }}>
          Pending {game.pendingPenalty.type === "PICK_TWO" ? "Pick Two" : "Pick Three"}:{" "}
          {currentPlayer(game) === me
            ? `Draw ${game.pendingPenalty.count} or stack`
            : `${nameOf(currentPlayer(game))} must take ${game.pendingPenalty.count}`}
        </div>
      )}

      <div className="card-panel" style={{ padding: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px" }}>
          <strong>Your hand · {myHand.length}</strong>
          <span className="muted" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FinalityDot />
            {isMyTurn ? "Your turn" : `${nameOf(currentPlayer(game))}'s turn`}
          </span>
        </div>
        <div className="hand-bar">
          {myHand.map((c) => {
            const playable = isMyTurn && validatePlay(game, me, c, c.shape === "whot" ? "circle" : undefined).ok;
            return (
              <CardView
                key={c.id}
                card={c}
                selected={selectedCardId === c.id}
                disabled={!playable}
                onClick={() => selectCard(c.id)}
              />
            );
          })}
        </div>
        <div className="actions-bar">
          <button
            className="btn btn-primary"
            disabled={!isMyTurn || !selectedCardId}
            onClick={() => playSelected()}
          >
            Play Card
          </button>
          {game.pendingPenalty && currentPlayer(game) === me ? (
            <button className="btn btn-warn" onClick={acceptPenalty}>
              Take {game.pendingPenalty.count}
            </button>
          ) : (
            <button className="btn" disabled={!isMyTurn} onClick={drawCard}>
              Draw
            </button>
          )}
          {myHand.length === 1 && (
            <button className="btn" onClick={declareLast}>
              Last Card!
            </button>
          )}
        </div>
      </div>

      {whotPicker && (
        <div className="shape-picker" onClick={() => setWhotPicker(undefined)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            {(["circle", "triangle", "cross", "square", "star"] as Shape[]).map((s) => (
              <button key={s} onClick={() => playSelected(s)}>
                <ShapeIcon shape={s} />
                <span className="label">{s}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FinalityDot() {
  const finality = useApp((s) => s.finality);
  const tip = finality[finality.length - 1];
  if (!tip) return null;
  const final = tip.final;
  const partial = tip.ackCount > 0 && !final;
  const cls = final ? "ready" : partial ? "" : "notready";
  const title = `${tip.ackCount}/${tip.required} acks · seq #${tip.sequence}`;
  return (
    <span
      title={title}
      aria-label={title}
      className={`dot ${cls}`}
      style={
        partial
          ? { background: "var(--warn)", boxShadow: "0 0 0 4px rgba(245,158,11,0.18)" }
          : undefined
      }
    />
  );
}

function ShapeIcon({ shape }: { shape: Shape }) {
  const map: Record<Shape, string> = {
    circle: "●",
    triangle: "▲",
    cross: "✚",
    square: "■",
    star: "★",
    whot: "✦",
  };
  const color: Record<Shape, string> = {
    circle: "var(--circle)",
    triangle: "var(--triangle)",
    cross: "var(--cross)",
    square: "var(--square)",
    star: "var(--star)",
    whot: "white",
  };
  return <span style={{ color: color[shape] }}>{map[shape]}</span>;
}
