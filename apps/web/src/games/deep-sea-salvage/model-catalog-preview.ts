const fish = [
  ["sun-sardine", "ヒカリイワシ", "イワシ型"], ["glass-bream", "ガラスダイ", "タイ型"],
  ["ribbon-goby", "リボンハゼ", "ハゼ型"], ["blue-puffer", "アオフグ", "フグ型"],
  ["coral-ray", "サンゴエイ", "エイ型"], ["silver-hatchet", "ギンオノウオ", "ハチェット型"],
  ["lantern-cod", "ランタンタラ", "タラ型"], ["veil-squid", "ベールイカ", "イカ型"],
  ["saw-shrimp", "ノコギリエビ", "エビ型"], ["moon-jelly", "ツキクラゲ", "クラゲ型"],
  ["abyss-eel", "アビスウナギ", "ウナギ型"], ["black-fang", "クロキバウオ", "キバウオ型"],
  ["ghost-squid", "ユウレイイカ", "深海イカ型"], ["star-mouth", "ホシグチ", "アンコウ型"],
  ["deep-ray", "シンカイエイ", "深海エイ型"],
] as const;
const rare = [
  ["prism-fish", "プリズムフィッシュ", "光沢魚型"], ["crown-jelly", "オウカンクラゲ", "冠クラゲ型"],
  ["comet-eel", "スイセイウナギ", "発光ウナギ型"], ["ruby-angler", "ルビーアンコウ", "アンコウ型"],
  ["void-manta", "ヴォイドマンタ", "マンタ型"],
] as const;
const environment = [
  ["cliff-detail", "海底岩壁", "玄武岩・鉱物層"], ["kelp", "海藻", "複数の葉と茎"], ["vent", "熱水噴出口", "煙突群と発光口"],
] as const;

function cards(items: ReadonlyArray<readonly [string, string, string]>) {
  return items.map(([id, name, note]) => `<article class="deep-sea-model-card">
    <a href="/assets/deep-sea-salvage/encyclopedia/${id}.png" target="_blank" title="${name}を拡大表示"><img src="/assets/deep-sea-salvage/encyclopedia/${id}.png" alt="${name}の3Dモデル" /></a>
    <strong>${name}</strong><span>${note}</span><code>${id}</code>
  </article>`).join("");
}

function showCatalog() {
  document.body.classList.add("is-game-screen", "is-deep-sea-model-catalog");
  document.querySelector("#arcade-screen")?.classList.add("is-hidden");
  document.querySelector("#cabinet-screen")?.classList.add("is-hidden");
  document.querySelector("#game-screen")?.classList.remove("is-hidden");
  const frame = document.querySelector(".game-frame");
  if (!frame || frame.querySelector(".deep-sea-model-catalog")) return;
  const catalog = document.createElement("section"); catalog.className = "deep-sea-model-catalog";
  catalog.innerHTML = `<header><div><p>DEEP SEA SALVAGE / ORGANIC REALISM PASS</p><h1>3Dモデル 全体確認</h1><span>同じ照明・正投影で比較。画像を押すと拡大で確認できます。</span></div><a href="?game=deep-sea-salvage&surfacePreview=1">ゲームで確認</a></header>
    <h2>通常魚 15種</h2><div class="deep-sea-model-grid">${cards(fish)}</div>
    <h2>レア魚 5種</h2><div class="deep-sea-model-grid">${cards(rare)}</div>
    <h2>ボス魚</h2><div class="deep-sea-model-grid deep-sea-model-grid-boss">${cards([["leviathan", "リヴァイアサン", "架空の装甲深海怪物"]])}</div>
    <h2>環境・障害物</h2><div class="deep-sea-model-grid">${cards(environment)}</div>`;
  frame.appendChild(catalog);
}

showCatalog(); requestAnimationFrame(showCatalog);
export {};
