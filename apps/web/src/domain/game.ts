export type GameId = string;
export type GameMode = "solo" | "versus" | "coop";
export type PlaySessionStatus = "waitingStart" | "playing" | "finished" | "cancelled";

export interface GameDefinition {
  id: GameId;
  slug: string;
  title: string;
  localizedTitle: string;
  shortTitle: string;
  description: string;
  instructions?: { objective: string; desktop: string[]; mobile: string[]; action: string; ending: string; tips: string[] };
  currentVersion: string;
  creditCost: number;
  iconUrl: string;
  promoVideoUrl: string;
  promoPosterUrl: string;
  status: "active" | "comingSoon";
}

export interface PlaySession {
  id: string;
  cabinetSessionId: string;
  gameId: GameId;
  gameVersion: string;
  mode: GameMode;
  status: PlaySessionStatus;
  startedAt: number | null;
  endedAt: number | null;
}

export const BUZZ_BARRIER: GameDefinition = {
  id: "graze-duel",
  slug: "buzz-barrier",
  title: "BUZZ BARRIER",
  localizedTitle: "バズバリア",
  shortTitle: "BB",
  description: "弾幕かすり・無敵体当たり・ボス撃破型シューティング",
  instructions: {
    objective: "3体のボスを倒し、ハイスコアを目指す。",
    action: "弾をかすってレベルアップ。無敵シールドをボスに当てて攻撃する。",
    ending: "ラスボス撃破でクリア。ライフがなくなるとゲームオーバー。",
    desktop: ["移動：矢印キー / WASD", "低速移動：Shift", "開始・一時停止：Space"],
    mobile: ["画面内をタッチし、スライドして移動", "画面下のボタンで開始・一時停止"],
    tips: ["レベルアップの無敵時間を活用して、弾幕とボスに近づこう。"],
  },
  currentVersion: "prototype-score-ranking-1",
  creditCost: 1,
  iconUrl: "/assets/buzz-barrier-icon.png",
  promoVideoUrl: "/demos/buzz-barrier/boss-demo-v1.mp4",
  promoPosterUrl: "/demos/buzz-barrier/boss-demo-v1.jpg",
  status: "active",
};

export const DEEP_SEA_SALVAGE: GameDefinition = {
  id: "deep-sea-salvage",
  slug: "deep-sea-salvage",
  title: "DEEP SEA SALVAGE",
  localizedTitle: "深海サルベージ",
  shortTitle: "DSS",
  description: "魚を調査して電力を補い、巨大深海魚を追う無限潜航ゲーム",
  instructions: {
    objective: "魚を調査しながら、より深い海を目指す。",
    action: "魚に近づくと自動調査し、電力を補充できる。",
    ending: "巨大深海魚の調査完了でクリア。電力切れ・船体大破でゲームオーバー。",
    desktop: ["移動：矢印キー / WASD", "開始・ポーズ：P　図鑑：F"],
    mobile: ["画面内のタッチ操作で潜水艦を移動", "画面下のボタンで開始・ポーズ・図鑑"],
    tips: ["深海の水流や高速魚を避けながら、巨大深海魚を追おう。"],
  },
  currentVersion: "prototype-survey-dive-2",
  creditCost: 1,
  iconUrl: "/assets/deep-sea-salvage-icon.svg",
  promoVideoUrl: "",
  promoPosterUrl: "/assets/deep-sea-salvage-icon.svg",
  status: "active",
};

export const MOCHI_BEAT: GameDefinition = {
  id: "mochi-beat",
  slug: "mochi-beat",
  title: "MOCHI BEAT",
  localizedTitle: "もちつきビート",
  shortTitle: "MB",
  description: "お手本を聞いて、トン・トン！うさぎとおもちをつくワンボタンリズムゲーム",
  currentVersion: "mochi-beat-sets-2",
  creditCost: 1,
  iconUrl: "/assets/mochi-beat-icon.svg",
  promoVideoUrl: "",
  promoPosterUrl: "/assets/mochi-beat-icon.svg",
  status: "active",
};

export const DOT_WAVE: GameDefinition = {
  id: "dot-wave", slug: "dot-wave", title: "DOT WAVE", localizedTitle: "ドットウェーブ",
  shortTitle: "DW", description: "音符で攻めてリズムで守る、ソロプレイ・観戦対応のネオンバトル",
  instructions: {
    objective: "リズムで攻めて守り、CPUの全3ステージ制覇を目指す。",
    action: "お手本のリズムで攻撃。相手のリズムをまねしてシールドで守る。",
    ending: "エネルギーがなくなるか、規定の攻防回数に達すると決着。残りエネルギーの多い側が勝利。",
    desktop: ["リズム入力：Space / F", "ポーズ：P", "音を出してプレイしてください。"],
    mobile: ["画面のリズムボタンをタップ", "音を出してプレイしてください。"],
    tips: ["音を出して、まずはお手本をよく聞こう。"],
  },
  currentVersion: "dot-wave-online-1", creditCost: 1, iconUrl: "/assets/dot-wave-icon.svg",
  promoVideoUrl: "/dot-wave-promo.mp4?v=20261007", promoPosterUrl: "/dot-wave-promo-poster.jpg?v=20261007", status: "active",
};
export const GAME_CATALOG: readonly GameDefinition[] = [BUZZ_BARRIER, DOT_WAVE, DEEP_SEA_SALVAGE];
export const DEFAULT_GAME_ID: GameId = BUZZ_BARRIER.id;

export function getGameDefinition(gameId: string | null | undefined): GameDefinition | null {
  if (!gameId) return null;
  return GAME_CATALOG.find((game) => game.id === gameId || game.slug === gameId) ?? null;
}

export function getActiveGames(): readonly GameDefinition[] {
  return GAME_CATALOG.filter((game) => game.status === "active");
}

export function resolveGameDefinition(gameId: string | null | undefined): GameDefinition {
  return getGameDefinition(gameId) ?? BUZZ_BARRIER;
}
