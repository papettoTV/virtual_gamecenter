# BGM比較版の確認（2026-10-14）

全30秒。無音の元版 ../cut/index.html へ音声は追加していない。HTMLとシーン2ファイルをStudioの識別子とタイトル差分以外で比較し、映像・文字・タイムラインの一致を確認。

Sun in Your Eyes / Alejandro Magaña (A. M.)、Mixkit Stock Music Free License。SNS動画・オンライン広告への使用許可を提供元の https://mixkit.co/license/modal/musicFree/ で確認。音源はローカルに保存、出典とSHA256記録、Gitでは単体再配布しない。

音源MP3のフルデコードと30秒以上の長さを確認。0–30秒の音量オートメーションはtimelineおよびStudioのWebMCP読み取りで認識。プレビューをUIで再生し、タイムラインが最後まで進行、ブラウザの警告・エラーログ0件。無音ではない音声ストリームを確認。エージェントによる主観的な試聴評価は行っていない。

元音源の冒頭40秒は -10.1 LUFS、true peak +0.2 dBFS。控えめな音量レーンを適用したPCM測定は約 -22.9 LUFS、true peak -10.5 dBFS。音量0→0.12で入り、投稿0.20、観戦0.25、対戦0.30、タイトル0.27→0.23→0へ。これは同じ線形レーンを再現した測定値でありMP4書き出しの検査値ではない。測定用PCMはtmpにのみ保存。

HyperFrames 0.8.154 strict check、lint/runtime/layout/contrastのエラー・警告・infoすべて0。check-C-bgm-comparison-30s.json。書き出し前の比較用Studioプレビューを別ポート3020で稼働。無音版は3019で保持。新しいMP4は未書き出し。


## 2026-10-14 筐体アップの復旧と群衆の環境音
CLIスナップショットでは筐体アップが見える一方、Studioの3.6秒ではコピーだけ切り替わり、元のゲーセン通路が残ることをUIで確認。2枚の筐体画像へローカル3–6秒の表示時間を明示。修正後のStudioで背中越しのプレイヤーと実録ゲーム画面が表示されることを確認。これまでの静止画検査だけではStudio固有の表示ずれを検出できていなかった。
冒頭0–6秒に人の話し声の環境音。Mixkit Big crowd talking loop / item 364、8–14秒から抜粋。音源6秒分のフルデコードと出典・ライセンスを確認。0.35秒でフェードイン、5.05–6秒でフェードアウト。Studioの音声クリップ読み取りで開始0・長さ6・エンベロープ5点を確認。BGMと合わせたPCM測定は約 -22.5 LUFS / true peak -10.5 dBFS。測定は同じ線形エンベロープの再現、主観的な試聴は未評価。
1.5、3.05、3.6、5、6.1、28.8秒の画像で筐体アップと投稿・ラストを確認。HyperFrames 0.8.154 strict check：lint/runtime/layout/contrastのエラー・警告・infoとも0。レポートcheck-C-bgm-crowd-30s.json。元の無音版とBGM曲・音量は変更なし。MP4は未書き出し。


## 2026-10-14 承認済みMP4の納品
ユーザーがBGM・ざわめき版を承認し、MP4書き出しを明示依頼。HyperFrames 0.8.154 / delivery / 30fps / 2 workersでPULBASE-C-30s-BGM-crowd-v1.mp4を作成。1080×1920、30.000秒、900フレーム、H.264 / yuv420p、AAC stereo / 48kHz、25,207,032 bytes。screenshot capture / hardware GPU、全ソースのフレームを抽出（coverage ratio=1）、73秒で完了。元動画のキーフレーム間隔の警告は記録し、実書き出しの動く弾幕と自機を確認。
同じMP4の映像ストリームを再圧縮せずコピーし、音声なしの../cut/PULBASE-C-30s-silent-v1.mp4も保存。映像パケットのSHA256一致、無音版の音声ストリーム0、30秒900フレームを確認。元の無音プロジェクトindex.htmlはSHA256一致で変更なし。
音ありMP4を最後までフルデコード成功。実際のAAC音声は -22.6 LUFS / true peak -10.3 dBFS。0.5–5、7–12、24–27、29–30秒を、承認済みの2トラックと同じ音量レーンで作ったPCMと比較し、相関0.995以上。冒頭のざわめきとBGM、6秒以後のBGM、終端フェードがMP4に反映。主観的な聴感評価はユーザーのプレビュー承認による。
実MP4の1.5・3.6・8.5・14・19・22.5・24.5・26.5・29.9秒を画像で確認。ゲーセン→筐体アップ→投稿→観戦→申し込みと承認→上下対戦→PULBASEのメインタイトルが正しく表示。検証JSONと実MP4のコンタクトシートを保存。


## 2026-10-14 v2：上部見出し・投稿の自機・心の声
「あの頃のゲームセンター」「休憩中、友だちのポスト。」をDOMと専用CSSから削除し、残ったアニメーション参照も整理。元の冒頭コピーとXロゴは保持。
投稿カードは元の実録静止画に自機があることを確認。横長枠のobject-positionをcenter bottomへ変更し、実録の自機と弾幕が見えるようにした。画像内容の生成・描き足しなし。Studio実プレビュー8.5秒でも自機が表示されることを確認。
心の声のみ “自分も、挑んでみたい。” と曲線ダブルクォートで囲む。フォント50→48pxで一行を保ち、ピンクの帯と既存の横移動・尺は維持。18.7秒と20.6秒で左右の引用符が見えることを確認。
CLIは0.8.154→0.8.157へ更新。更新後のstrict checkでlint/runtime/layout/contrastのエラー・警告・infoは全て0。新しいCLIでプレビューを再起動。render実行中だけStudioが作業用HTMLを検査して一時的なエラーを出したが、書き出し後は作業用フォルダー自動削除とStudio lint 0を確認。
更新MP4：PULBASE-C-30s-BGM-crowd-v2.mp4、同一の映像パケットから音声を外した../cut/PULBASE-C-30s-silent-v2.mp4。30秒、1080×1920、30fps、900フレーム、H.264 / yuv420p。音ありはAAC stereo 48kHz。フルデコード成功。v1音声パケットのSHA256と完全一致し、BGM・ざわめき・音量とフェードを維持。実AAC音量 -22.6 LUFS / true peak -10.3 dBFS。旧v1 MP4と旧無音プロジェクトは保持。
実MP4の1.5・3.6・8.5・18.7・20.6・29.6秒を目視確認。最終検証verification-C-v2-delivery.jsonとコンタクトシートquality-C-v2-final-MP4-contact.jpg。delivery、screenshot capture / hardware GPU / 2 workers、68.9秒で書き出し。
