import { ResultShareButton } from "../../../features/sharing/ShareActions";
import { PlatformExperience } from "../../../features/platform/PlatformExperience";
import type { DotWaveRoster } from "../../../domain/cabinet";
import MochiDuel from "./MochiDuel";
import { useDotWaveCabinet } from "./useDotWaveCabinet";

export default function DotWaveCabinet() {
  const controller = useDotWaveCabinet();
  if (!controller) return null;
  const { state: d, network: net, audio, share, requestChallenge, rematch, respondRematch, respond, takeSeat, leaveResult, showError } = controller;
  const resultDraft = controller.getResultShareDraft();
  const viewingResult = net.role === "spectator" && net.latest?.engine.mode === "online" && ["impact", "finished"].includes(net.latest.engine.phase);
  const players = d.result && d.resultPlayers ? d.resultPlayers
    : viewingResult && d.room?.dotWaveResultPlayers ? d.room.dotWaveResultPlayers
    : d.room?.dotWavePlayers ? [d.room.dotWavePlayers[0], d.room.dotWavePlayers[1] ?? {name:"CPU",wins:0}] as DotWaveRoster : undefined;
  const canChallenge = net.connected && net.role === "spectator" && !net.matchId && d.room && (["soloPlaying", "challengePending", "versusReady", "versusPlaying", "result"].includes(d.room.status) || (d.room.status === "occupied" && net.latest?.engine.phase === "finished"));
  return <>
    <div className="dot-cabinet-bar dot-wave">
      <span>{!net.connected ? "接続中…" : net.matchId ? net.side === 1 ? "あなたはピンク側" : "あなたはシアン側" : net.role === "player" ? "あなたの筐体" : "観戦中"} · {d.room?.spectatorCount ?? 0}人</span>
      <div className="dot-cabinet-actions"><button disabled={!controller.canShareLive()} onClick={() => void share()}>ライブを共有</button>
      <div className="dot-cabinet-seat-action">{canChallenge && !d.applied && <button disabled={d.busy} onClick={() => void requestChallenge()}>1クレジットで対戦</button>}
      {d.applied && <button onClick={() => controller.cancelChallenge()}>{d.queue ? `${d.queue}人待ち` : "承認待ち"} · キャンセル</button>}
      {net.role === "spectator" && d.room?.playerCount === 0 && <button disabled={!net.connected} onClick={takeSeat}>この席でプレイ</button>}</div></div>
      {net.role === "spectator" && !net.matchId && d.room?.status === "occupied" && net.latest?.engine.phase !== "finished" && <p className="dot-cabinet-status-note" role="status">別の画面がプレイヤー席を使用しています。その画面で開始するか、ゲーム一覧に戻って席を空けてください。</p>}


    </div>
    <MochiDuel key={d.revision} players={players} network={net} sharedAudio={audio}
      challengePending={d.pending && net.role === "player"}
      challengeNotice={<>{d.pending && net.role === "player" && <div className="dot-challenge-prompt" role="dialog" aria-label="対戦の申し込み"><strong>対戦の申し込みが来ました</strong><button onClick={() => void respond(true)}>対戦する</button><button onClick={() => void respond(false)}>今回は断る</button></div>}</>}
      boardNotice={<>{net.matchId && !net.startsAt && !d.result && <p role="status">対戦の準備中…</p>}</>}
      holdResult={Boolean(d.result && !net.matchId && net.role === "player")}
      resultPanel={<>{resultDraft && <ResultShareButton draft={resultDraft} />}{d.result && Date.now() - d.resultAt >= 2500 && <div className="dot-match-result" role="status"><strong>{d.result.winner === "draw" ? "引き分け" : d.result.winner === d.seat ? "あなたの勝ち！" : "相手の勝ち！"}</strong>{d.rematchPending && <div role="dialog" aria-label="再挑戦の申し込み"><strong>再挑戦の申し込みが来ました</strong><button onClick={() => void respondRematch(true).catch(showError)}>対戦する</button><button onClick={() => void respondRematch(false).catch(showError)}>今回は断る</button></div>}{d.result.winner !== "draw" && d.result.winner !== d.seat && <button disabled={d.busy || d.rematchRequested} onClick={() => void rematch()}>{d.rematchRequested ? "承認待ち" : "再挑戦（1クレジット）"}</button>}<button onClick={leaveResult}>{d.result.winner === d.seat || (d.result.winner === "draw" && d.seat === "host") ? "CPUと対戦し直す" : "観戦に戻る"}</button></div>}</>}
    />
    {!(window.self !== window.top && new URLSearchParams(location.search).get("preview") === "1") && <PlatformExperience standaloneCredits/>}
  </>;
}
