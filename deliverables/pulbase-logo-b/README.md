# PULBASE B — 単色SVG・サイズ検証

## 採用版（2026-10-14）

ユーザーが採用したのは「少し細い版」。線幅を揃えた版との比較で、前の版のバランスを優先。

- 白：`pulbase-b-slim-white.svg`
- 黒：`pulbase-b-slim-black.svg`
- favicon：`favicon-slim-dark-16.png` / `favicon-slim-dark-32.png`
- 比較：`preview-slim.html`

縦線52、上36、下・右40（SVG座標）を維持。`uniform`版は比較用で採用しない。サイトへの適用・カラー検討・公開は未実施。


採用した「B / SLIM」を数値で再構成したレビュー用の初稿。サイト本体には未適用。

- `pulbase-b-white.svg` / `pulbase-b-black.svg`: 256×256 viewBox、透明背景、白・黒の単色シンボル。左右の頭の抜きは同じ半径18。稲妻の周囲は幅10の抜き。
- `favicon-{dark,light}-{16,32}.png`: SVGから高解像度で描画して縮小した、実寸16・32px PNG。各背景色を含む。
- `preview.html`: 原寸favicon・ピクセル拡大、白黒反転、現行サイト上部の文字組みとロゴ追加案、360pxスマホ幅の比較。
- `comparison.png` / `comparison-mobile.png`: ローカルChrome、deviceScaleFactor=1での表示確認。
- `build-preview.cjs`: PNGとスクリーンショットの再生成。バンドルされたsharp / PlaywrightとローカルChromeを使用。

## 確認結果

4つのPNGは実寸16・32px。比較ページの全画像が読み込み成功。390px幅で横方向のはみ出しなし。スクリーンショットを目視確認。

ヘッダーと32pxではP・稲妻の形を確認できる。16pxでは細い抜きが弱く、頭の意味まで読み取るのは難しい。採用前に小サイズ専用の線幅・抜きの調整を検討する。今回は同じ原図の縮小で比較し、簡略版は作成していない。

サイト文字は既存システムフォントの仮組みで、生成画像の文字をトレースしたものではない。プレビューはApp.tsx / styles.cssの上部構成を基にした静的比較であり、実サイト全体のスクリーンショットではない。カラー検討、サイト適用、push、Cloudflare公開は未実施。

## 少し細い比較版

`preview-slim.html` / `comparison-slim.png` に現行と細い版を並べた。
`pulbase-b-slim-{white,black}.svg` は稲妻・外形・頭の半径を維持し、内側の抜きを上下左右に4単位拡大。上下の線40→36、縦線56→52。16・32px PNGも生成し、読み込みと寸法を検証。再生成は `node build-slim.cjs`。現行SVGとサイト本体は維持。

## 線幅を揃えた版

`preview-uniform.html` / `comparison-uniform.png` は細い版と線幅統一版の比較。
`pulbase-b-uniform-{white,black}.svg` は直線部分を36単位に統一：縦線52→36、上36を維持、下・右40→36。頭の抜き半径18と稲妻は維持。丸い抜きのある部分・角丸は一定線幅とは異なる。16・32px PNGの寸法と画像読み込みを検証し、比較画像を目視確認。再生成は `node build-uniform.cjs`。
