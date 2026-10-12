import { useEffect, useState } from "react";
import type { SharedResult } from "../../domain/shared-result";
import { navigate } from "../../shared/navigation";
import { ResultCard, ResultShareButton } from "./ShareActions";
import { recordResultViewed } from "./sharing-events";
import { getGameDefinition } from "../../domain/game";

export function SharedResultPage({ resultId }: { resultId: string }) {
  const [result, setResult] = useState<SharedResult | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    void fetch(`/api/results/${encodeURIComponent(resultId)}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("result_unavailable");
      const data = await response.json() as { result: SharedResult };
      if (controller.signal.aborted) return;
      setResult(data.result); setStatus("ready");
      recordResultViewed(data.result.gameId, data.result.id);
    }).catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, [resultId, attempt]);
  const game = result ? getGameDefinition(result.gameId) : null;
  return <main className="shell shared-result-page">
    <p className="eyebrow">PULBASE / PLAY RESULT</p>
    <h1>プレイ結果</h1>
    {status === "loading" ? <p role="status">結果を読み込んでいます…</p> : status === "error" ? <><p role="alert">結果が見つからないか、読み込めませんでした。</p><button type="button" onClick={() => setAttempt(value => value + 1)}>再読み込み</button></> : result && <>
      <ResultCard result={result} />
      <p>{result.playerName} / <time dateTime={result.createdAt}>{new Date(result.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</time></p>
      <p>プレイ終了時の記録です。リプレイ映像ではありません。</p>
      <ResultShareButton draft={result} placement="result-page" />
    </>}
    <div className="shared-result-next">
      {game && <button type="button" className="platform-primary-button" onClick={() => navigate(`/?game=${encodeURIComponent(game.id)}`)}>自分も挑戦</button>}
      <button type="button" onClick={() => navigate("/")}>開催中のライブ・他のゲームを見る</button>
    </div>
  </main>;
}
