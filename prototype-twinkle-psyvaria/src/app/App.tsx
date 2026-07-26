import { useEffect } from "react";
import { ArcadeScreen } from "../features/arcade/ArcadeScreen";
import { CabinetScreen } from "../features/cabinet/CabinetScreen";
import { GameScreen } from "../features/game/GameScreen";
import { PlatformExperience } from "../features/platform/PlatformExperience";

export function App() {
  useEffect(() => {
    void import("../games/graze-duel/runtime");
  }, []);

  return (
    <main className="shell">
      <section className="intro">
        <p className="eyebrow">Virtual Arcade Prototype</p>
        <h1>ゲームセンター</h1>
        <p>
          オンライン上にゲームセンター体験を再現する試作です。ゲーム一覧から遊びたいゲームを選び、筐体に入ってプレイします。
        </p>
      </section>
      <PlatformExperience />
      <ArcadeScreen />
      <CabinetScreen />
      <GameScreen />
    </main>
  );
}
