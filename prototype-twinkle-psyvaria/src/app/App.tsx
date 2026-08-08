import { useEffect, useState } from "react";
import { ArcadeScreen } from "../features/arcade/ArcadeScreen";
import { CabinetScreen } from "../features/cabinet/CabinetScreen";
import { GameScreen } from "../features/game/GameScreen";
import { PlatformExperience } from "../features/platform/PlatformExperience";
import { DEFAULT_GAME_ID, resolveGameDefinition } from "../domain/game";
import { loadGameRuntime } from "../games/registry";
import { BRAND } from "../domain/brand";

export function App() {
  const [activeGameId, setActiveGameId] = useState(() => getGameIdFromLocation());
  const activeGame = resolveGameDefinition(activeGameId);

  useEffect(() => {
    void loadGameRuntime(activeGame.id);
  }, [activeGame.id]);

  useEffect(() => {
    const syncGameFromLocation = () => setActiveGameId(getGameIdFromLocation());
    window.addEventListener("popstate", syncGameFromLocation);
    return () => window.removeEventListener("popstate", syncGameFromLocation);
  }, []);

  const selectGame = (gameId: string) => {
    const game = resolveGameDefinition(gameId);
    setActiveGameId(game.id);
    const cabinetId = crypto.randomUUID();
    history.pushState(
      { cabinetId, gameId: game.id },
      "",
      `/cabinets/${cabinetId}?game=${encodeURIComponent(game.id)}`,
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    void loadGameRuntime(game.id);
  };

  return (
    <main className="shell">
      <section className="intro">
        <p className="eyebrow brand-category">{BRAND.category}</p>
        <h1>{BRAND.name}</h1>
        <p className="brand-tagline">{BRAND.tagline}</p>
      </section>
      <ArcadeScreen onSelectGame={selectGame} />
      <CabinetScreen game={activeGame} />
      <GameScreen game={activeGame} />
      <PlatformExperience />
    </main>
  );
}

function getGameIdFromLocation(): string {
  return new URL(window.location.href).searchParams.get("game") ?? DEFAULT_GAME_ID;
}
