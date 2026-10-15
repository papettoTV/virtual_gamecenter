# PULBASE 宣伝画像セット v1

動画の冒頭カットをもとに、11サイズを個別にレイアウトした静止画セットです。作成日: 2026-10-16。

サービス名、コピー「すぐ遊べる。観戦から、対戦も。」、URL、暖色のゲームセンター写真、シアンのラインを引き継いでいます。

## ファイルの選び方

- **jpg/**: 投稿や共有に使う軽量なJPEG。迷ったらこちら。
- **png/**: 全11サイズのPNG。文字を含む画像の保存用・加工用マスター。
- **webp/**: OGP・サイト画像・広告の6サイズ。サイトに配置するときの軽量版。OGPにはJPEGを推奨します。
- **index.html**: 全サイズの比較と、各形式へのリンク。
- **contact-sheet.jpg**: 全11サイズの一覧。配信用画像そのものではありません。
- **PULBASE-promo-images-v1.zip**: 配布用画像と使い方をまとめたZIP。編集用ソース・フォントは含みません。

| ファイル名のサイズ部分 | 用途 | レイアウト調整 |
| --- | --- | --- |
| `ogp-1200x630` | サイトのOGP・リンク共有 | 左に文字、右に写真。サービス名とURLを大きく配置 |
| `social-wide-1200x675` | SNS横長投稿・16:9の告知 | 横長専用の左右配置。写真を少し広く見せる縦方向の余裕 |
| `social-square-1080x1080` | SNS正方形投稿 | 上側に人と筐体、下側に大きなタイトルとコピー |
| `social-portrait-1080x1350` | SNS縦長投稿・4:5 | にぎわいを上側に残し、文字を下側にまとめる |
| `story-1080x1920` | ストーリー・縦長告知 | 動画冒頭に近い中央配置。文字は上下の端から離す |
| `web-hero-1920x1080` | サイトのメイン画像・16:9告知 | 大画面向けの左右構成、余白と大きなサービス名 |
| `web-banner-1920x640` | サイト内・紹介記事の横長バナー | 高さを抑え、文字を左、にぎわいを右に集約 |
| `x-header-1500x500` | Xプロフィールヘッダー | 左下のプロフィール写真を避けて、文字を中央寄りに配置 |
| `ad-rectangle-300x250` | レクタングル広告 | 英語カテゴリを省き、日本語コピーを2行に分ける |
| `ad-leaderboard-728x90` | 横長広告 | 英語カテゴリを省き、サービス名・コピー/URL・写真を横並びにする |
| `ad-mobile-320x100` | モバイル広告 | コピーを「観戦から、対戦も。」に短縮。サービス名とURLを優先 |

例: `jpg/pulbase-ogp-1200x630.jpg`。

## サイズを選んだ理由

OGP・投稿用・サイト用は、使い回しやすい比率を今回の用途に合わせて選んでいます。すべてのサービスの必須サイズという意味ではありません。縦長のメイン画像をそのまま一括トリミングせず、文字・写真・余白の位置や文字サイズを個別に調整しました。

- Xのヘッダーは公式ヘルプの推奨 **1500×500** に合わせています。[X公式ヘルプ](https://help.x.com/en/managing-your-account/common-issues-when-uploading-profile-photo)
- 小型広告は、Google広告が対応する **300×250 / 728×90 / 320×100** を選択しています。同ページの静止画像上限は150KBで、このセットの3サイズはPNG・JPEGとも上限内です。[Google広告の仕様](https://support.google.com/google-ads/answer/1722096?hl=ja)
- 1200×630はリンク共有用の実用サイズとして採用しています。OGPの規格自体はこの画素数を必須にしていません。[Open Graph Protocol](https://ogp.me/)

サイト用画像は画像全体を表示する前提です。スマートフォンで別の縦横比に切り抜く場合は、縦長・正方形版へ切り替えると文字を保てます。ストーリーやXヘッダーのUIによる隠れ方は端末や掲載面で変わるため、掲載時のプレビューで確認してください。

## 元素材・編集用データ

- 写真: `../pulbase-C-hyperframes/cut/assets/arcade-opening-crowded-v1.png`
- 写真SHA-256: `030c49ad0a6615da99e5187e1fba03fb4ebf89d94edebe5e1bb6cfcf26f83feb`
- 生成履歴: `../pulbase-C-hyperframes/cut-bgm/image-provenance-crowded-opening-v10.json`
- タイトルの基準: `../pulbase-C-hyperframes/cut-bgm/compositions/c-opening-title.html`
- 写真は動画用に生成された架空のゲームセンターです。
- `source/layouts/<用途>/index.html`: サイズ別の編集用静的HTML。
- `source/build_layouts.py`: 個別レイアウトの生成元。書体は動画と同じローカルの `Japanese.ttc` を参照。
- `source/export_images.py`: HyperFrames 0.8.162で検査・PNG取得し、PillowでJPEG/WebPを保存。
- フォントと動画素材への参照は同じリポジトリ内の相対リンクです。フォントファイルを単体で再配布していません。

再生成（リポジトリのルートで実行、PythonにPillowが必要）:

```sh
python3 deliverables/pulbase-promo-images-v1/source/build_layouts.py
python3 deliverables/pulbase-promo-images-v1/source/export_images.py
python3 deliverables/pulbase-promo-images-v1/source/package_images.py
```

編集用HTMLは幅・高さを固定して設計したものです。レスポンシブなサイトのHTMLではありません。動画本体の構成・尺・音声は変更していません。

## 確認

全11レイアウトをHyperFramesのstrict check（文字切れ・重なり・コントラスト・読み込み）に通し、書き出し後の寸法・形式を検査しています。全体一覧と、小型広告の原寸も目視確認しています。各ファイルの画素数・容量・SHA-256は `manifest.json`、検査の集計は `verification.json` に保存しています。
