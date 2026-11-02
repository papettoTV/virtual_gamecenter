import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Feedback } from "../../src/features/feedback/Feedback";
import { SiteFooter } from "../../src/features/platform/PlatformPolicies";
import { setLiveContext, type LiveShareContext } from "../../src/features/sharing/share-service";
import { navigate } from "../../src/shared/navigation";
import "../../styles.css";

const gameId = new URLSearchParams(location.search).get("game")!;
const cabinet = `/cabinets/feedback-check?game=${encodeURIComponent(gameId)}`;
let role: LiveShareContext["role"] = "player";
function live(phase: LiveShareContext["phase"]) {
  setLiveContext({ gameId, cabinetId: "feedback-check", role, phase });
}
live("ready");
function Journey() {
  const [address, setAddress] = useState(location.pathname + location.search);
  useEffect(() => {
    const sync = () => setAddress(location.pathname + location.search);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  return <>
    <Feedback address={address} />
    <main className="shell">
      <h1>{address === "/" ? "トップ" : "フィードバック検査用の筐体"}</h1>
      <button onClick={() => { role = "player"; live("playing"); navigate(cabinet); }}>プレイ開始</button>
      <button onClick={() => live("finished")}>プレイ終了</button>
      <button onClick={() => { role = "spectator"; live("playing"); navigate(`${cabinet}&watch=1`); }}>観戦開始</button>
      <button onClick={() => live("paused")}>一時停止</button>
      <button onClick={() => live("playing")}>再開</button>
      <button onClick={() => { setLiveContext(null); navigate("/"); }}>トップへ戻る</button>
    </main>
    <SiteFooter key={address} />
  </>;
}
createRoot(document.getElementById("root")!).render(<Journey />);
