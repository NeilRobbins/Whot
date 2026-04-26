import { useApp } from "../store";
import { SHORT_BUILD_ID } from "@protocol-core/build-info";

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
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        <span className="tag">P2P</span>
        <span
          className="tag"
          title="Build identifier — share this when reporting bugs so the dev knows which version each browser is running"
          style={{ fontSize: 10, opacity: 0.7 }}
        >
          build {SHORT_BUILD_ID}
        </span>
      </div>
    </header>
  );
}
