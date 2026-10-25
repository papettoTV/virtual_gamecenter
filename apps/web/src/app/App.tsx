import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { ArcadeScreen } from "../features/arcade/ArcadeScreen";
import { CabinetScreen } from "../features/cabinet/CabinetScreen";
import { GameScreen } from "../features/game/GameScreen";
import { PlatformExperience } from "../features/platform/PlatformExperience";
import { DEFAULT_GAME_ID, DOT_WAVE, resolveGameDefinition, type GameDefinition } from "../domain/game";
import { getGameRegistration } from "../games/registry";
import { BRAND } from "../domain/brand";
import { gamePlayUrl, startNewGame } from "../features/cabinet/play-navigation";
import { SpectatorGate } from "../features/cabinet/SpectatorGate";
import { NotificationCenter } from "../features/notifications/NotificationCenter";
import { notifications } from "../features/notifications/notifications";
import type { CanvasGameModule } from "../game-sdk/contracts";
import { GameLifetime } from "../game-sdk/lifetime";
import { gameHost } from "../game-sdk/game-host";
import { navigate } from "../shared/navigation";
import { SharedResultPage } from "../features/sharing/SharedResultPage";
import { SharePanel } from "../features/sharing/ShareActions";
import { sharePanel } from "../features/sharing/share-service";
import { AnalyticsConsent } from "../features/analytics/AnalyticsConsent";
import { installLeaveGameConfirmation } from "../features/game/leave-game";
import { Feedback } from "../features/feedback/Feedback";

const ThreeBulletLab = lazy(async () => {
  const module = await import("../features/labs/ThreeBulletLab");
  return { default: module.ThreeBulletLab };
});

export function App() {
  useEffect(installLeaveGameConfirmation, []);
  const [address, setAddress] = useState(() => location.pathname + location.search);
  useEffect(() => {
    const sync = () => setAddress(location.pathname + location.search);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const url = new URL(address, location.origin);
  const requested = url.searchParams.get("game");
  const game = resolveGameDefinition(requested === "mochi-beat" || ["/labs/dot-wave", "/labs/mochi-duel"].includes(url.pathname) ? DOT_WAVE.id : requested ?? DEFAULT_GAME_ID);
  const isCabinet = /^\/cabinets\/[^/]+$/.test(url.pathname);
  const preview = isCabinet && url.searchParams.get("watch") === "1"
    && url.searchParams.get("preview") === "1" && window.self !== window.top;
  useEffect(() => {
    document.body.classList.toggle("is-showcase-preview", preview);
    return () => document.body.classList.remove("is-showcase-preview");
  }, [preview]);
  const selection = requested !== null || url.pathname.startsWith("/labs/");
  const resultMatch = /^\/results\/([^/]+)$/.exec(url.pathname);
  useEffect(() => {
    sharePanel.close();
    if (!resultMatch) document.title = selection || isCabinet ? `${game.title}${url.searchParams.get("watch") === "1" ? "の観戦" : ""} | PULBASE` : `${BRAND.name} | ${BRAND.category}`;
  }, [address]);
  return <>{!preview && <><NotificationCenter /><SharePanel /><AnalyticsConsent /><Feedback address={address} /></>}{
    resultMatch ? <SharedResultPage key={resultMatch[1]} resultId={resultMatch[1]!} /> :
    url.pathname === "/labs/buzz-barrier-three" ?
      <Suspense fallback={<Loading />}><ThreeBulletLab /></Suspense> :
    isCabinet ? <SpectatorGate key={`${url.pathname}:${url.searchParams.get("watch")}:${preview}`} game={game} url={url} preview={preview}>
      <GameRoute game={game} preview={preview} />
    </SpectatorGate> :
      <main className={`shell${!selection ? " showroom-shell" : ""}`}>
        {!selection && <section className="intro">
          <p className="eyebrow brand-category">{BRAND.category}</p>
          <h1 className="brand-heading"><img className="brand-wordmark" src="/brand/pulbase-wordmark.svg" alt={BRAND.name} /><span className="brand-reading">{BRAND.reading}</span></h1>
          <p className="brand-tagline">{BRAND.tagline}</p>
        </section>}
        {selection ? <StartGameRedirect game={game} /> : <ArcadeScreen onSelectGame={startNewGame} />}
        <PlatformExperience standaloneCredits />
      </main>
  }</>;
}

function StartGameRedirect({ game }: { game: GameDefinition }) {
  useEffect(() => {
    navigate(gamePlayUrl(game.id), { replace: true });
  }, []);
  return <Loading />;
}

type LoadedGame = { canvas: CanvasGameModule } | { Component: ComponentType };
function GameRoute({ game, preview = false }: { game: GameDefinition; preview?: boolean }) {
  const [loaded, setLoaded] = useState<LoadedGame | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    const registration = getGameRegistration(game.id);
    void registration.load().then(module => {
      if (!disposed) setLoaded(registration.kind === "canvas" ? { canvas: module as CanvasGameModule } : module as { Component: ComponentType });
    }).catch(() => {
      if (!disposed) setFailed(true);
    });
    return () => { disposed = true; };
  }, [game.id]);
  if (failed) return <main className="shell"><p>ゲームを読み込めませんでした。</p><button onClick={() => location.reload()}>再読み込み</button></main>;
  if (!loaded) return <Loading />;
  if ("Component" in loaded) return <loaded.Component />;
  return <main className="shell"><CanvasRuntime game={game} module={loaded.canvas} />{!preview && <PlatformExperience />}</main>;
}

function CanvasRuntime({ game, module }: { game: GameDefinition; module: CanvasGameModule }) {
  useEffect(() => {
    const lifetime = new GameLifetime();
    const instance = module.mountGame({ game, lifetime });
    const detach = gameHost.attach(instance);
    return () => {
      detach();
      instance.dispose();
      lifetime.dispose();
      document.body.classList.remove("is-game-screen", "is-cabinet-screen", "is-spectating", "is-mobile-game");
      notifications.clearScope(game.id);
    };
  }, [game, module]);
  return <><CabinetScreen game={game} /><GameScreen game={game} /></>;
}

function Loading() {
  return <main className="shell" role="status">ゲームを準備しています…</main>;
}
