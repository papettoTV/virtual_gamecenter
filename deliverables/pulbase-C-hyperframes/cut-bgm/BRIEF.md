---
workflow: general-video
flow: automation
message: "観ていた自分が、挑む側になる"
destination: sns
aspect: 9:16
language: ja
length: 30s
---

## BGM比較版
2026-10-14：ユーザー依頼「その方向でBGMを1曲合わせた比較版を作ってみて。無音版も残しておいて」。
無音の完成済み30秒版は ../cut に保持し、このプロジェクトだけにBGMを追加。映像・文字・尺・シーンの動きは同一。人物・筐体カット、X風の「いまプレイ中！」、動く自機、対戦、PULBASEのメインタイトルを維持。

## 音楽
Sun in Your Eyes / Alejandro Magaña (A. M.)。MixkitのSynthwaveカテゴリから選曲。https://mixkit.co/free-stock-music/synthwave/
曲の冒頭0–30秒を使う。ナレーション・ゲーム音なし。冒頭0–6秒に人のざわめきを追加。1.2秒で柔らかく入り、6秒の投稿から11.5秒の観戦に向けてゆっくり上げ、23.5秒の対戦は少し前へ、28.6–30秒で余韻を残してフェードアウト。
音量はdata-automationで指定し、Studioと書き出しの同じエンベロープを使用。元MP3の色付け・速度変更・ループ・つなぎ編集なし。

## 保存と利用条件
無音版：../cut 。BGM版：この cut-bgm 。assetsの相対シンボリックリンクで映像素材だけを共用し、scene HTMLは別コピー。
音源はこの動画制作のため .media/audio/bgm/ にローカル保存し、単体再配布を避けるためGit対象外。取得先とSHA256はbgm-provenance.json。提供元のStock Music Free LicenseはSNS動画・オンライン広告を許可。条件の確認記録はlicenses/。動画内へのクレジット追加なし。BGMはゲームアプリ本体に組み込まない。
比較用プレビューを承認後、2026-10-14にユーザーの明示依頼でMP4へ書き出し。BGM・ざわめき入りと同一映像の無音版を別ファイルで保存。


## 2026-10-14 筐体アップのプレビュー修正と人のざわめき
筐体アップは3–6秒。ソースとCLIスナップショットには入っていたが、Studioの実プレビューでは背景写真とゲーム静止画のタイミングが未指定で、3.6秒に筐体画像が見えない状態を確認。2枚のimgへdata-start=3、data-duration=3と別トラックを明示し、実プレビューで筐体アップが表示されることを確認。
冒頭0–6秒にMixkit「Big crowd talking loop」（item 364）の8–14秒を使用。ゲーセンを演出する人混みの話し声の環境音で、実際のゲームセンターでの収録ではない。0–0.35秒で入り、0.30–0.35程度の控えめな音量で重ね、5.05–6秒にフェードアウト。SNS投稿からはBGMのみ。音源は.media/audio/sfx/crowd-talking-loop.mp3へローカル保存し、単体再配布なし。出典と音量はcrowd-provenance.json。無音版は変更しない。
