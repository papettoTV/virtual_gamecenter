import { useCallback, useEffect, useState } from "react";
import "./cabinet-directory.css";

interface CabinetEntry {
  cabinetId: string;
  status: string;
  spectatorCount: number;
}

const POPULAR_SPECTATOR_COUNT = 3;
const REFRESH_INTERVAL_MS = 3000;
const CABINET_PREVIEW_LIMIT = 4;
const PLAYING_STATUSES = new Set([
  "soloPlaying",
  "challengePending",
  "versusPlaying",
  "result",
]);

function useCabinets() {
  const [cabinets, setCabinets] = useState<CabinetEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCabinets = useCallback(async () => {
    try {
      const response = await fetch("/api/cabinets?gameId=graze-duel", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const data = await response.json() as { cabinets?: CabinetEntry[] };
      setCabinets(data.cabinets ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCabinets();
    const refreshTimer = window.setInterval(() => void loadCabinets(), REFRESH_INTERVAL_MS);
    window.addEventListener("popstate", loadCabinets);
    return () => {
      window.clearInterval(refreshTimer);
      window.removeEventListener("popstate", loadCabinets);
    };
  }, [loadCabinets]);

  return { cabinets, loading };
}

function openCabinet(cabinetId: string) {
  history.pushState({ cabinetId }, "", `/cabinets/${cabinetId}?watch=1`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function CabinetDirectory() {
  const { cabinets, loading } = useCabinets();

  useEffect(() => {
    const leaveForAnotherGame = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>(
        "#cabinet-top-back, #game-back-to-arcade, #spectator-game-back",
      );
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    };

    const gameButtons = [
      document.querySelector<HTMLButtonElement>("#game-back-to-arcade"),
      document.querySelector<HTMLButtonElement>("#spectator-game-back"),
    ];
    for (const button of gameButtons) {
      if (button) button.textContent = "別のゲームをする";
    }

    const normalizeCabinetLabels = () => {
      const summary = document.querySelector<HTMLElement>("#cabinet-summary");
      if (summary && summary.textContent !== "筐体を選択 / 1 Credit") {
        summary.textContent = "筐体を選択 / 1 Credit";
      }

    };
    normalizeCabinetLabels();
    const labelObserver = new MutationObserver(normalizeCabinetLabels);
    labelObserver.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    const syncScreenClass = () => {
      const cabinetScreen = document.querySelector("#cabinet-screen");
      document.body.classList.toggle(
        "is-cabinet-screen",
        Boolean(cabinetScreen && !cabinetScreen.classList.contains("is-hidden")),
      );
    };
    syncScreenClass();
    const screenObserver = new MutationObserver(syncScreenClass);
    const cabinetScreen = document.querySelector("#cabinet-screen");
    if (cabinetScreen) {
      screenObserver.observe(cabinetScreen, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    document.addEventListener("click", leaveForAnotherGame, true);
    return () => {
      labelObserver.disconnect();
      screenObserver.disconnect();
      document.body.classList.remove("is-cabinet-screen");
      document.removeEventListener("click", leaveForAnotherGame, true);
    };
  }, []);

  useEffect(() => {
    const startWatchingWhenReady = () => {
      const url = new URL(window.location.href);
      if (url.searchParams.get("watch") !== "1") return;
      const watchButton = document.querySelector<HTMLButtonElement>("#start-solo");
      if (
        !watchButton
        || watchButton.disabled
        || !watchButton.textContent?.includes("観戦する")
      ) {
        return;
      }
      url.searchParams.delete("watch");
      history.replaceState(history.state, "", `${url.pathname}${url.search}`);
      watchButton.click();
    };

    const watchTimer = window.setInterval(startWatchingWhenReady, 250);
    return () => window.clearInterval(watchTimer);
  }, []);

  if (loading || cabinets.length === 0) return null;

  return (
    <div className="cabinet-directory" aria-label="プレイ中の筐体一覧">
      <div className="cabinet-dots">
        {cabinets.map((cabinet, index) => {
          const popular = cabinet.spectatorCount >= POPULAR_SPECTATOR_COUNT;
          const label = popular
            ? `筐体${index + 1}を観戦。盛り上がり中、観戦者${cabinet.spectatorCount}人`
            : `筐体${index + 1}を観戦。観戦者${cabinet.spectatorCount}人`;
          return (
            <button
              key={cabinet.cabinetId}
              className={popular ? "cabinet-dot is-popular" : "cabinet-dot"}
              type="button"
              aria-label={label}
              title={label}
              onClick={() => openCabinet(cabinet.cabinetId)}
            />
          );
        })}
      </div>
    </div>
  );
}

export function CabinetSelector() {
  const { cabinets, loading } = useCabinets();
  const currentCabinetId = window.location.pathname.match(/^\/cabinets\/([^/]+)/)?.[1];
  const playingCabinets = cabinets
    .filter((cabinet) => (
      cabinet.cabinetId !== currentCabinetId
      && PLAYING_STATUSES.has(cabinet.status)
    ))
    .slice(0, CABINET_PREVIEW_LIMIT);

  const startSolo = () => {
    window.dispatchEvent(new CustomEvent("create-solo-cabinet"));
  };

  return (
    <section className="cabinet-selector" aria-labelledby="cabinet-selector-title">
      <div className="cabinet-selector-heading">
        <div>
          <p className="eyebrow">SELECT CABINET</p>
          <h3 id="cabinet-selector-title">遊ぶ筐体を選ぶ</h3>
        </div>
        <p>新しい筐体でソロプレイを始めるか、プレイ中の筐体を観戦できます。</p>
      </div>

      <div className="cabinet-machine-grid">
        <button className="cabinet-machine-card is-solo" type="button" onClick={startSolo}>
          <CabinetMachineScreen mode="ready" />
          <strong>ソロでプレイ</strong>
          <small>新しい筐体を作成してプレイ開始</small>
        </button>

        {playingCabinets.map((cabinet, index) => (
          <button
            key={cabinet.cabinetId}
            className="cabinet-machine-card is-playing"
            type="button"
            onClick={() => openCabinet(cabinet.cabinetId)}
          >
            <CabinetMachineScreen mode="playing" index={index} />
            <span className="cabinet-machine-name">プレイ中筐体 {index + 1}</span>
            <strong>観戦する</strong>
            <small>
              {cabinet.spectatorCount > 0
                ? `観戦者 ${cabinet.spectatorCount}人`
                : "ゲーム進行中"}
            </small>
          </button>
        ))}

        {!loading && playingCabinets.length === 0 && (
          <div className="cabinet-machine-empty">
            <CabinetMachineScreen mode="empty" />
            <strong>観戦</strong>
            <small>他のプレイヤーのゲーム開始待機中</small>
          </div>
        )}
      </div>
    </section>
  );
}

function CabinetMachineScreen({
  mode,
  index = 0,
}: {
  mode: "ready" | "playing" | "empty";
  index?: number;
}) {
  return (
    <span className="cabinet-machine" aria-hidden="true">
      <span className="cabinet-machine-marquee">BUZZ BARRIER</span>
      <span className={`cabinet-machine-monitor is-${mode}`}>
        {mode !== "playing" ? (
          <>
            <span className="cabinet-ready-logo">BB</span>
            <span className="cabinet-ready-text">
              {mode === "ready" ? "PRESS START" : "NO PLAYER"}
            </span>
          </>
        ) : (
          <>
            <span className={`cabinet-demo-ship ship-${index % 3}`} />
            <span className="cabinet-demo-boss" />
            <span className="cabinet-demo-bullets">
              <i /><i /><i /><i /><i />
            </span>
          </>
        )}
      </span>
      <span className="cabinet-machine-controls">
        <i />
        <i />
        <i />
      </span>
      <span className="cabinet-machine-base" />
    </span>
  );
}
