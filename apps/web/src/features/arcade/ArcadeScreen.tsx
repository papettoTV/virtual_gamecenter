import { useEffect, useRef, useState } from "react";
import { getActiveGames, type GameDefinition } from "../../domain/game";
import { openCabinet, useCabinets, type CabinetEntry } from "./CabinetDirectory";
import { getShowcaseCabinets, livePreviewUrl } from "./showcase-model";
import { GameDemo } from "./GameDemo";
import "./showcase.css";

export function ArcadeScreen({ onSelectGame }: { onSelectGame: (gameId: string) => void }) {
  return <section className="arcade-showroom" aria-label="ゲームを見て回る">
    {getActiveGames().map(game => <GameShowcase key={game.id} game={game} onSelectGame={onSelectGame} />)}
    <article className="game-showcase showcase-coming-soon" aria-label="新しいゲームを準備中">
      <div className="showcase-window" aria-hidden="true"><span>COMING SOON</span></div>
      <div className="showcase-description"><h2>Coming Soon</h2><p>次のゲームとの出会いを、お楽しみに。</p></div>
    </article>
  </section>;
}

function GameShowcase({ game, onSelectGame }: { game: GameDefinition; onSelectGame: (gameId: string) => void }) {
  const { cabinets } = useCabinets(game.id);
  const playing = getShowcaseCabinets(cabinets);
  const cabinet = playing[0];
  const element = useRef<HTMLElement>(null);
  const media = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(document.visibilityState !== "hidden");
  useEffect(() => {
    const resize = new ResizeObserver(entries => setScale((entries[0]?.contentRect.width ?? 960) / 960));
    if (media.current) resize.observe(media.current);
    const observer = new IntersectionObserver(entries => setVisible(Boolean(entries[0]?.isIntersecting)), { threshold: 0.15 });
    if (element.current) observer.observe(element.current);
    const visibility = () => setForeground(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", visibility);
    return () => { resize.disconnect(); observer.disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  const active = visible && foreground;
  const watch = () => cabinet ? openCabinet(cabinet.cabinetId, game.id) : onSelectGame(game.id);
  return <article className="game-showcase" ref={element} aria-labelledby={`showcase-${game.id}`}>
    <div className="showcase-window" ref={media}>
      {cabinet && active ? <LivePreview key={cabinet.cabinetId} cabinet={cabinet} game={game} scale={scale} />
        : <GameDemo game={game} active={active && !cabinet} />}
      <span className={`showcase-badge ${cabinet ? "is-live" : ""}`}>
        {cabinet ? "● LIVE" : "DEMO"}
        {cabinet && <span>観戦 {cabinet.spectatorCount}人</span>}
      </span>
      <button className="showcase-window-link" type="button" onClick={watch}
        aria-label={cabinet ? `${game.title}を観戦する` : `${game.title}を選択`} />
    </div>
    <div className="showcase-description">
      <div><h2 id={`showcase-${game.id}`}>{game.title}</h2><small>{game.localizedTitle}</small></div>
      <p>{game.description}</p>
      {playing.length > 0 && <div className="showcase-cabinets" aria-label={`${game.title}のプレイ中筐体`}>
        <span>{playing.length}台プレイ中</span>
        <div>{playing.map((entry, index) => <button key={entry.cabinetId} type="button"
          className={`showcase-cabinet ${entry.spectatorCount >= 3 ? "is-popular" : ""}`}
          aria-label={`筐体${index + 1}を観戦。観戦者${entry.spectatorCount}人`}
          data-preview={entry.cabinetId === cabinet?.cabinetId}
          onClick={() => openCabinet(entry.cabinetId, game.id)} />)}</div>
      </div>}
      <div className="showcase-actions">
        <button type="button" className="showcase-watch" disabled={!cabinet} onClick={watch}
          title={cabinet ? undefined : "プレイ中の筐体がないため観戦できません"}>観戦する <span aria-hidden="true">↗</span></button>
        <button type="button" onClick={() => onSelectGame(game.id)}>{cabinet ? "自分も遊ぶ" : "遊ぶ"} <span aria-hidden="true">→</span></button>
      </div>
    </div>
  </article>;
}

function LivePreview({ cabinet, game, scale }: { cabinet: CabinetEntry; game: GameDefinition; scale: number }) {
  const [loaded, setLoaded] = useState(false);
  return <>
    {!loaded && <div className="showcase-loading" role="status">ライブに接続中…</div>}
    <iframe className="showcase-live"
      style={{ width: 960, height: 640, transform: `scale(${scale})`, transformOrigin: "top left", opacity: loaded ? 1 : 0 }}
      src={livePreviewUrl(cabinet)} onLoad={() => setLoaded(true)}
      title={`${game.title}のライブプレビュー`} tabIndex={-1} aria-hidden="true" allow="autoplay 'none'" />
  </>;
}
