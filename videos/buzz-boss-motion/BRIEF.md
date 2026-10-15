---
workflow: motion-graphics
flow: automation
storyboard: no
message: 球体は位置固定で回転、結晶体は回転しながらトゲが一定周期で伸縮する
aspect: "16:9"
language: ja
length: 9.6s
---

# 動作確認

ゲーム実装前の独立した動作プレビュー。左は初代ボス（位置固定・既存と同じ回転）、右はラスボス（既存の回転に6本のトゲの同期した伸縮を追加）。中ボスは対象外。音声不要。

実ゲームの幾何モデルと回転関数を再利用。ゲーム本体を変更しない。
トゲは2.4秒周期、最大長の62〜100%で伸縮。立方体状の中心は変形させない。
見やすさのため拡大し、弾幕や移動は省略する。

Catalog search: rotating geometric crystal sphere. Orb shaders and image carousels did not match the existing sparse boss geometry, so reuse the repository models. Motion uses deterministic sine-wave-loop and split comparison layout, without decorative entrances.

動画ファイルへの書き出しはプレビュー確認後。プレビュー自体はそのまま再生・編集できる。
