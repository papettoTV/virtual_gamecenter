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
