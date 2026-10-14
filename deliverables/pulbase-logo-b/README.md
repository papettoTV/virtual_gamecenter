# PULBASE B — 単色SVG・サイズ検証

## 採用版（2026-10-14）

ユーザーが採用したのは「少し細い版」。線幅を揃えた版との比較で、前の版のバランスを優先。

- 白：`pulbase-b-slim-white.svg`
- 黒：`pulbase-b-slim-black.svg`
- favicon：`favicon-slim-dark-16.png` / `favicon-slim-dark-32.png`
- 比較：`preview-slim.html`

縦線52、上36、下・右40（SVG座標）を維持。`uniform`版は比較用で採用しない。サイトへの適用・公開は未実施。配色は下記の採用配色を参照。


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

## カラー比較

`preview-colors.html` / `comparison-colors.png`：採用したslim版の形を変えず、シアン#69F7FF、アンバー#FFBD45、ライム#BAFF39を比較。各色につき全体単色（文字も同色）と白いP＋稲妻だけ着色（文字は白）の2案、計6案。背景はサイトの#090B18。

各SVGは `pulbase-b-slim-{cyan,amber,lime}-{mono,bolt}.svg`。SVGの読み込みと比較画像を目視確認。再生成は `node build-colors.cjs`。色の最終選択・サイト適用・公開は未実施。


## 採用配色（2026-10-15）

白いP（#FFFFFF）＋シアンの稲妻（#69F7FF）、`pulbase-b-slim-cyan-bolt.svg`を採用。形はslim版を維持。

`preview-cyan.html` / `comparison-cyan.png` / `comparison-cyan-mobile.png`で16・32px favicon、明暗タブ、PC・360pxスマホのヘッダー仮組みを比較。`favicon-cyan-{16,32}.png`は背景#090B18を含み、明るいタブでも白いPを識別できる。2つのPNGの寸法、全画像の読み込み、390px幅で横方向にはみ出さないことを検証。比較画像を目視確認。再生成：`node build-cyan.cjs`。

32pxとヘッダーでは白いPとシアンの稲妻を識別できる。16pxは稲妻の色が分かる一方、頭や細い隙間の意味は読み取りにくい。サイト本体への適用・push・公開は未実施。

## 書体比較（2026-10-15）

`preview-fonts.html` / `comparison-fonts.png`：現在のsystem-ui 700、Space Grotesk 500・600、Chakra Petch 600、Sora 600、Rajdhani 700の6案。候補の字間は0.03em、現在は0。48px・30pxで比較。

`preview-font-headers.html` / `comparison-font-headers.png`：PC文字72px/シンボル72px、スマホ文字36px/シンボル40pxの静的ヘッダー比較。採用シンボルの形・配色を維持。現在のsystem-uiはmacOS撮影環境の書体で、他OSとは異なることがある。サイト本体は未変更。

フォントはGoogle Fonts公式リポジトリ `https://github.com/google/fonts/tree/main/ofl/` のspacegrotesk、chakrapetch、sora、rajdhaniから取得し、fonts/にOFLライセンスを同梱。Space Grotesk・Soraは可変TTF、他2つは指定ウェイトのTTF。再生成は `node build-fonts.cjs`。各ウェイトの実際のFontFace読み込みとSVG画像のdecodeを確認し、比較画像を目視確認。

## 文字ロゴの加工比較（2026-10-15）

`preview-wordmarks.html` / `comparison-wordmarks.png`：Chakra Petch SemiBoldの加工前、文字のPへ稲妻を統合する③、P/Bの上辺へ2つの切り欠きを入れる④。各案は大サイズ・小サイズ・シンボル併用ヘッダー・360px幅の文字単体を比較。シンボル併用は③で稲妻が重複することも確認するための参考。

`wordmark-chakra-{base,bolt,cuts}.svg`は実フォントのアウトラインを使用し、フォントの読み込みに依存しない。文字の字間は各案共通（1000UPMで30単位追加）、個別カーニングはまだ未調整。加工案は検討段階、サイトへ未適用。

SVG再生成：fontToolsを用意して `python3 build-wordmarks.py`。比較画像：`node build-wordmarks.cjs`。全SVG読み込みと比較画像を目視確認。元書体のOFLはfonts/chakrapetch-OFL.txtを参照。


## 採用文字ロゴ（2026-10-15）

ユーザーが③「Pにシアンの稲妻を組み込む」を採用。文字ロゴの正本は `wordmark-chakra-bolt.svg`。Chakra Petch SemiBoldのアウトラインを土台とし、先頭Pにシアン#69F7FFの稲妻を統合。④と加工前は比較用に保持。

favicon等のシンボルは引き続き `pulbase-b-slim-cyan-bolt.svg`。文字ロゴ単体では独立シンボルを添えず、稲妻の重複を避ける構成を基本とする。サイトの文字部分への適用・push・公開はまだ行っていない。
