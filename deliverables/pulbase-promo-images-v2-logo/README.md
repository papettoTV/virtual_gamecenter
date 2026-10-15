# PULBASE 宣伝画像 v2 — 採用ロゴ版

動画の冒頭カットから作った宣伝画像を、採用済みの文字ロゴに差し替えた11サイズの比較版です。v1はそのまま保持しています。作成日: 2026-10-16。

## 採用の判断

サイトの宣伝画像では、サービス名と公式サイトの見た目を揃える効果があるため、採用済みの文字ロゴを使用するのが適切と判断しました。白い文字とシアンの稲妻は、暗いゲームセンター写真と既存のアクセント色にもなじみます。

使用したのは **Pにシアンの稲妻を組み込んだ文字ロゴ** `wordmark-chakra-bolt.svg`。ロゴ制作チャット「PULBASEロゴの方向性を提案」の採用指示と、サイトの `apps/web/public/brand/pulbase-wordmark.svg` が同じSVGであることを確認しています。

- ロゴのSHA-256: `c98a5f7a139d83e70afe285a80cc21503dd3cd3b46a752288feb39ae8d6b5c82`
- 元データ: `../pulbase-logo-b/wordmark-chakra-bolt.svg`
- このセット内の同一コピー: `brand/pulbase-wordmark.svg`
- ロゴは縦横比・輪郭・白とシアンの配色を保持。文字はアウトライン化済みで、ロゴ用フォントの読み込みは不要です。
- 独立シンボルの追加はしていません。文字のPに稲妻を組み込んだ採用形をそのまま見せています。
- 罫線と小型バナーのURL色も、ロゴのシアン `#69F7FF` に揃えました。
- 小型広告は英語カテゴリを省略し、ロゴの幅とURLの読みやすさを優先しています。

## 見る・使う

- `comparison-before-after.jpg`: v1とロゴ版の比較（OGPと小型バナー）。
- `contact-sheet.jpg`: ロゴ版全11サイズの一覧。
- `index.html`: 各サイズのプレビューと形式別リンク。
- `jpg/`: 全11サイズ。SNS投稿・共有に向く軽量なJPEG。
- `png/`: 全11サイズ。文字を含む画像の保存用マスター。
- `webp/`: OGP・サイト・広告の6サイズ。サイトでの軽量配信向け。OGP設定にはJPEGを使えます。
- `PULBASE-promo-images-v2-logo.zip`: 画像・一覧・ガイド・ロゴSVGをまとめたZIP。

| ファイル名のサイズ部分 | 用途 |
| --- | --- |
| `ogp-1200x630` | OGP・リンク共有 |
| `social-wide-1200x675` | SNS横長投稿（16:9） |
| `social-square-1080x1080` | SNS正方形投稿 |
| `social-portrait-1080x1350` | SNS縦長投稿（4:5） |
| `story-1080x1920` | ストーリー・縦長告知 |
| `web-hero-1920x1080` | サイトのメイン画像・16:9告知 |
| `web-banner-1920x640` | サイト横長バナー |
| `x-header-1500x500` | Xプロフィールヘッダー |
| `ad-rectangle-300x250` | レクタングル広告 |
| `ad-leaderboard-728x90` | 横長広告 |
| `ad-mobile-320x100` | モバイル広告 |

例: `jpg/pulbase-logo-ogp-1200x630.jpg`。

## レイアウトとサイズの扱い

v1で個別に組んだ文字・写真の配置を引き継ぎ、タイトルの占める大きさに合わせてSVGを置き直しました。横長は左右配置、正方形・縦長は写真に重ね、ヘッダーは左下のプロフィール写真を避け、小型広告は情報量を絞っています。

サイズの選定はv1から引き継いでいます。OGP・SNS・サイト用は実用的な比率として選んだサイズで、すべての掲載面の必須寸法ではありません。Xヘッダーは [X公式ヘルプ](https://help.x.com/en/managing-your-account/common-issues-when-uploading-profile-photo)、小型広告は [Google広告の仕様](https://support.google.com/google-ads/answer/1722096?hl=ja) をもとにしています。

サイト上で画像全体を表示する前提です。別の縦横比にトリミングする場合は、その比率に近い版を選んでください。

## 元素材・再生成

- 写真: `../pulbase-C-hyperframes/cut/assets/arcade-opening-crowded-v1.png`。動画用に生成された架空のゲームセンターです。
- 写真SHA-256: `030c49ad0a6615da99e5187e1fba03fb4ebf89d94edebe5e1bb6cfcf26f83feb`
- 写真生成履歴: `../pulbase-C-hyperframes/cut-bgm/image-provenance-crowded-opening-v10.json`
- ロゴ元書体: Chakra Petch SemiBold。ライセンスは `brand/chakrapetch-OFL.txt`。
- 編集用HTML: `source/layouts/<用途>/index.html`
- ロゴ以外の文字は動画と同じローカル `Japanese.ttc` を参照。フォントファイルそのものはZIPに含めていません。

同じリポジトリ内で再生成（PythonにPillow、Node 22以上が必要）:

```sh
python3 deliverables/pulbase-promo-images-v2-logo/source/build_layouts.py
python3 deliverables/pulbase-promo-images-v2-logo/source/export_images.py
python3 deliverables/pulbase-promo-images-v2-logo/source/package_images.py
```

全11レイアウトのstrict check（読み込み・文字切れ・重なり・テキストのコントラスト）、書き出し寸法・形式・容量を検査しています。SVGロゴの見え方は目視確認し、小型広告は原寸でも確認しています。`verification.json` に集計、`manifest.json` に各出力の容量・寸法・ハッシュを保存しています。
