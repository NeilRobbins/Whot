import { useApp } from "../store";

export function TopBar() {
  const screen = useApp((s) => s.screen);
  const role = useApp((s) => s.role);
  const gameId = useApp((s) => s.gameId);

  const subtitle =
    screen === "HOME"
      ? "Tap, share, play."
      : role === "HOST"
        ? `Hosting · ${gameId?.slice(0, 6) ?? ""}`
        : `Joined · ${gameId?.slice(0, 6) ?? ""}`;

  return (
    <header className="topbar">
      <div>
        <h1>Whot!</h1>
        <div className="muted">{subtitle}</div>
      </div>
      <span className="tag">P2P</span>
    </header>
  );
}
