# PULBASE Xプロフィール画像

- アップロード用：`pulbase-x-profile-1024.png`（1024×1024、背景#090B18）
- 編集用：`pulbase-x-profile.svg`
- 表示確認：`preview.png`（丸い切り抜き、大サイズ・64px・40px）

サイト採用シンボル `apps/web/public/brand/pulbase-logo.svg` を形・配色を変えずに使用。白いP＋シアン#69F7FFの稲妻。文字は加えず、小さいプロフィール表示での識別を優先。丸く切り抜かれても欠けない余白を設けた。PNG寸法とプレビューを確認。Xアカウントへの設定は未実施。

再生成：`node deliverables/pulbase-x-profile/build.cjs`

## ヘッダー画像

1500×500 PNGと編集用SVGを3案作成。採用済みのサイト文字ロゴを使用。

- `pulbase-x-header-logo-1500x500.png`：文字ロゴのみ。
- `pulbase-x-header-tagline-1500x500.png`：文字ロゴ＋「本気のプレイが、人を呼ぶ。」。
- `pulbase-x-header-signal-1500x500.png`：控えめな信号線＋文字ロゴ＋カテゴリー。
- `header-comparison.png`：プロフィール画像の重なりを想定した比較。プロフィール画像は確認用で、アップロード用ヘッダーには含まない。X実画面での配置検証は未実施。

全案のPNG寸法と比較画像を確認。再生成：`node deliverables/pulbase-x-profile/build-headers.cjs`。

## ゲーセン背景版

`pulbase-x-header-arcade-v1.png`：画像生成ツールで制作した3:1の横長ヘッダー案。参照元は「宣伝素材」チャットで使用している `deliverables/pulbase-C-hyperframes/cut/assets/arcade-opening-crowded-v1.png` と、既存の `pulbase-x-header-tagline-1500x500.png`。

指示：暖色の照明、筐体、プレイヤーと観客の背景を横長に展開。白いPULBASEとシアンの稲妻、タグラインを右側へ配置。左下に重要な文字を置かず、背景を残しながら文字背後だけ控えめに暗くする。画像生成による再構成であり、背景・ロゴの画素を厳密に保持した合成ではない。生成画像を目視確認。X実画面での表示・アカウント設定は未実施。

### v2：文字を拡大

`pulbase-x-header-arcade-v2-large-logo.png`：v1を画像生成ツールで編集し、文字ロゴを画面幅の約3分の2まで拡大。タグラインも拡大し、背景・左下の文字なし領域を維持する指示。生成結果を目視確認。v1は保持。正確なSVGの合成ではなく生成画像による再構成。

## 面取りPの採用版へ統一

プロフィール画像と単色背景ヘッダーは、サイト正本の面取りPを用いて再生成。旧データはversions/roundedに保持。

ゲーセン背景の最新ヘッダー：`pulbase-x-header-arcade-v3-angular-1500x500.png`（1500×500）。画像生成で文字なし背景 `arcade-background-v3.png` を作り、面取り版の正確なSVG文字ロゴとタグラインを重ねた。ロゴの輪郭は画像生成で描き直していない。編集用SVGと再生成スクリプトbuild-arcade-header.cjsも保存。Xアカウントへの設定は未実施。
