# PULBASE ブランド素材 最終確認版 v1

2026-10-17。シンプルな横長・右斜体Pを基に、画像生成の検討案をベクターで再設計した確認用セット。グラデーション・稲妻なし。**現時点では最終承認前。既存サイトの正本・X設定は変更していない。**

## 最初に見るもの

- `preview.html`：一覧。faviconはブラウザ倍率100%で確認。
- `review-sheet.png`：一覧画像。
- `manifest.json`：生成ファイル、寸法、SHA256。

## 正本

- `symbol-color.svg`：P単体。色 #29D9FF。
- `wordmark-color.svg`：タイトル。PUL #29D9FF、BASE #FFFFFF、筐体風Aの縁 #E773FF。
- `symbol-white.svg` / `wordmark-white.svg`：白一色。
- `symbol-black.svg` / `wordmark-black.svg`：濃紺一色 #071A34。
- `wordmark-light.svg`：明るい背景用。PUL #0675BD、BASE #071A34。
- `symbol-screen.svg` / `wordmark-screen.svg`：単色の塗りを保った発光版。小サイズ・印刷はフラット版を基本にする。

先頭Pとシンボルは同一のパスを使用。文字はすべて独自に描いたアウトラインで、閲覧端末のフォントに依存しない。生成画像を厳密にトレースしたものではなく、文字の幅・間隔・Aの形を調整したベクター再設計。印象の一致をこの一覧で承認してから採用データへ反映する。

## 書き出し

- 透過PNG：`symbol-{color,white,black}-1024.png`、`wordmark-{color,white,black,light}-2400.png`。
- favicon：SVG、16/32/48px PNG、3サイズ入りICO。背景 #03142D。
- タッチ・アプリアイコン候補：180/192/512px PNG（確認用、manifest等への組み込みは未実施）。
- Xプロフィール：`x-profile-1024.png` と編集用SVG。
- Xヘッダー：`x-header-plain-1500x500.png`、`x-header-arcade-1500x500.png` と編集用SVG。
- SNS/OGP用：`social-card-1200x630.png` と編集用SVG。配信メタタグへの適用は未実施。

ゲーセン背景は既存の `deliverables/pulbase-x-profile/arcade-background-v3.png` を同梱。これは画像生成素材。新しいロゴはSVGをそのまま重ねている。プロフィールとの重なりを考え、ヘッダー左下に文字を配置していない。X実画面での切り抜き確認は未実施。

## 検証・再生成

`node deliverables/pulbase-brand-review-v1/build.cjs`

同梱スクリプトはバンドル済みsharp、Playwright、ローカルChromeを使用。全プレビュー画像の読み込み、390px幅で横にはみ出さないこと、一覧の目視を確認。PNGの寸法はmanifestに記録。フォントのインストールは不要。

商標の類似調査は前の会話でのWeb目視調査まで。商標登録や独占性を保証するセットではない。
