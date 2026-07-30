import { useCallback, useEffect, useState } from "react";
import "./cabinet-directory.css";

interface CabinetEntry {
  cabinetId: string;
  status: string;
  spectatorCount: number;
}

const POPULAR_SPECTATOR_COUNT = 3;
const REFRESH_INTERVAL_MS = 3000;

export function CabinetDirectory() {
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

  useEffect(() => {
    const leaveForAnotherGame = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>(
        "#game-back-to-arcade, #spectator-game-back",
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

      const role = document.querySelector<HTMLElement>("#cabinet-role-label");
      if (role?.textContent !== "あなたがプレイヤーです") return;

      const description = document.querySelector<HTMLElement>("#cabinet-description");
      if (description?.textContent?.includes("フリープレイ")) {
        description.textContent = "この筐体に着席しています。1クレジットでソロプレイを開始できます。";
      }
    };
    normalizeCabinetLabels();
    const labelObserver = new MutationObserver(normalizeCabinetLabels);
    labelObserver.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    document.addEventListener("click", leaveForAnotherGame, true);
    return () => {
      labelObserver.disconnect();
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

  const openCabinet = (cabinetId: string) => {
    history.pushState({ cabinetId }, "", `/cabinets/${cabinetId}?watch=1`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

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
