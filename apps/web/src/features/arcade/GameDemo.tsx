import { useEffect, useRef } from "react";
import type { GameDefinition } from "../../domain/game";

export function GameDemo({ game, active }: { game: GameDefinition; active: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!video.current) return;
    if (active) void video.current.play().catch(() => {});
    else video.current.pause();
  }, [active]);
  useEffect(() => {
    if (game.id !== "deep-sea-salvage" || !active || !canvas.current) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void import("../../games/deep-sea-salvage/showcase-demo").then(module => {
      if (!disposed && canvas.current) stop = module.startShowcaseDemo(canvas.current);
    }).catch(() => {});
    return () => { disposed = true; stop?.(); };
  }, [active, game.id]);
  if (game.promoVideoUrl) return <video ref={video} muted loop playsInline preload="metadata"
    poster={game.promoPosterUrl} src={game.promoVideoUrl} aria-label={`${game.title}のデモ映像`} />;
  if (game.id === "deep-sea-salvage") return <canvas ref={canvas} width="960" height="640" aria-label={`${game.title}のデモプレイ`} />;
  return <img src={game.promoPosterUrl} alt={`${game.title}のプレイイメージ`} loading="lazy" />;
}
