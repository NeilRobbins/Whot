import { useEffect } from "react";
import { useApp } from "./store";
import { generateIdentity } from "@trust-core/identity";
import { HomeScreen } from "./screens/HomeScreen";
import { LobbyScreen } from "./screens/LobbyScreen";
import { GameScreen } from "./screens/GameScreen";
import { ResultScreen } from "./screens/ResultScreen";
import { TopBar } from "./components/TopBar";
import { ErrorBanner } from "./components/ErrorBanner";

export function App() {
  const screen = useApp((s) => s.screen);
  const identity = useApp((s) => s.identity);
  const setIdentity = useApp((s) => s.setIdentity);
  const setScreen = useApp((s) => s.setScreen);

  useEffect(() => {
    if (!identity) {
      generateIdentity().then(setIdentity);
    }
  }, [identity, setIdentity]);

  // Handle deep-link join via fragment.
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (params.get("game") && params.get("room") && params.get("join")) {
      // Stash params and route Home screen to display join flow.
      sessionStorage.setItem("whot.pendingJoin", hash);
      setScreen("HOME");
    }
  }, [setScreen]);

  return (
    <div className="app">
      <TopBar />
      <ErrorBanner />
      <main className="screen">
        {!identity ? (
          <div className="center-message">
            <div className="spinner" /> Generating your game key…
          </div>
        ) : screen === "HOME" ? (
          <HomeScreen />
        ) : screen === "LOBBY" ? (
          <LobbyScreen />
        ) : screen === "GAME" ? (
          <GameScreen />
        ) : (
          <ResultScreen />
        )}
      </main>
    </div>
  );
}
