import { createRoot } from "react-dom/client";
import { DotWaveResult } from "../../src/games/dot-wave/duel/DotWaveResult";
import { DotWaveRanking } from "../../src/games/dot-wave/duel/DotWaveRanking";
import { ResultShareButton } from "../../src/features/sharing/ShareActions";
import { Feedback } from "../../src/features/feedback/Feedback";
import { setLiveContext } from "../../src/features/sharing/share-service";
import "../../styles.css";
import "../../src/games/dot-wave/duel/style.css";

const cleared = new URLSearchParams(location.search).get("ending") !== "loss";
const score = { total: 54820, maxCombo: 42, combo: 0, bossBonus: 1200 };
setLiveContext({ gameId: "dot-wave", cabinetId: "local-result-fixture", role: "player", phase: "finished" });
createRoot(document.getElementById("root")!).render(<>
  <Feedback address={location.pathname} />
  <main className="dot-wave"><section className="duel-board has-final-result"><div className="duel-choice-panel duel-state-overlay is-final-result">
    <DotWaveResult summary={{ title: cleared ? "ALL CLEAR" : "GAME OVER", score: score.total, details: [
      ["STAGE", cleared ? "3 / 3" : "1 / 3"], ["最大コンボ", "42"], ["TIME", "180.00s"], ["体力ボーナス", "1,200"], ["自己ベスト", "54,820"],
    ] }} ranking={cleared && <DotWaveRanking score={score} elapsedTimeMs={180000} playerName="Player-確認用" />}
      actions={<><button className="duel-primary">1クレジットでリトライ</button><button className="dot-result-back">別のゲームを探す</button></>}
      share={<ResultShareButton draft={{ id: "local-fixture", gameId: "dot-wave", gameVersion: "dot-wave-score-1", score: score.total, elapsedTimeMs: 180000, cleared, metrics: { maxCombo: 42 } }} />}
    />
  </div></section></main>
</>);
