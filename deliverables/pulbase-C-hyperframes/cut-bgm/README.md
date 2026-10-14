# PULBASE C — 完成版 v3


2026-10-14：承認済みv2から、ユーザーの追加指示により全シーンの下部にあった素材説明を削除。完成動画は [PULBASE-C-30s-BGM-crowd-v3.mp4](PULBASE-C-30s-BGM-crowd-v3.mp4)（BGM・ざわめき入り）。無音版は [PULBASE-C-30s-silent-v3.mp4](../cut/PULBASE-C-30s-silent-v3.mp4)。30秒、1080×1920、30fps。旧v1・v2も保持。

- 無音版は `../cut`、BGM版はこの `cut-bgm`。
- `assets` は `../cut/assets` を参照する相対シンボリックリンク。両フォルダを一緒に保持。
- BGM素材は `.media/audio/bgm/sun-in-your-eyes.mp3`。元URLは `bgm-provenance.json`。Gitでは音源単体を再配布しない。
- 曲：Sun in Your Eyes — Alejandro Magaña (A. M.) / Mixkit。
- 音量エンベロープは `index.html` の `bgm-sun-in-your-eyes`。無音版のHTMLへは追加していない。
- `npx hyperframes preview --background --no-open --port 3020` で比較版を開く。

## 承認済みMP4（2026-10-14）

- 音あり：`PULBASE-C-30s-BGM-crowd-v1.mp4`（BGM全編＋人のざわめき0–6秒）。
- 無音：`../cut/PULBASE-C-30s-silent-v1.mp4`。上記の映像ストリームを再圧縮せずコピーし、音声トラックだけ除去。
- 両方とも30秒、1080×1920、30fps、900フレーム、H.264 / yuv420p / faststart。音あり版はAAC / stereo / 48kHz。
- 音源単体は配布しない。無音の旧プロジェクトソースと既存MP4も保持。
- 最終検証：`verification-C-delivery-MP4.json`、`quality-C-final-MP4-contact.jpg`。

## 完成版 v2（2026-10-14承認）

- 音あり：`PULBASE-C-30s-BGM-crowd-v2.mp4`。
- 同じ修正を含む無音：`../cut/PULBASE-C-30s-silent-v2.mp4`。
- 上部見出しを削除し、投稿画像の自機を表示。心の声のみ “自分も、挑んでみたい。”。
- 音声はv1と同一。旧v1 MP4も保存。
- 最終検証：`verification-C-v2-delivery.json`。

## 完成版 v3：下部の素材説明を削除（2026-10-14）

冒頭・筐体・SNS投稿・観戦・対戦・エンドタイトルに表示されていた素材や演出についての注記をすべて削除。中央のメッセージ・SNS投稿本文・PULBASEタイトル・BGM・ざわめき・尺は維持。出典はプロジェクト内の記録に保持。最終検証は `verification-C-v3-delivery.json`。
