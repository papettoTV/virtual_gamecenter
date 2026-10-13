# BGM比較版の確認（2026-10-14）

全30秒。無音の元版 ../cut/index.html へ音声は追加していない。HTMLとシーン2ファイルをStudioの識別子とタイトル差分以外で比較し、映像・文字・タイムラインの一致を確認。

Sun in Your Eyes / Alejandro Magaña (A. M.)、Mixkit Stock Music Free License。SNS動画・オンライン広告への使用許可を提供元の https://mixkit.co/license/modal/musicFree/ で確認。音源はローカルに保存、出典とSHA256記録、Gitでは単体再配布しない。

音源MP3のフルデコードと30秒以上の長さを確認。0–30秒の音量オートメーションはtimelineおよびStudioのWebMCP読み取りで認識。プレビューをUIで再生し、タイムラインが最後まで進行、ブラウザの警告・エラーログ0件。無音ではない音声ストリームを確認。エージェントによる主観的な試聴評価は行っていない。

元音源の冒頭40秒は -10.1 LUFS、true peak +0.2 dBFS。控えめな音量レーンを適用したPCM測定は約 -22.9 LUFS、true peak -10.5 dBFS。音量0→0.12で入り、投稿0.20、観戦0.25、対戦0.30、タイトル0.27→0.23→0へ。これは同じ線形レーンを再現した測定値でありMP4書き出しの検査値ではない。測定用PCMはtmpにのみ保存。

HyperFrames 0.8.154 strict check、lint/runtime/layout/contrastのエラー・警告・infoすべて0。check-C-bgm-comparison-30s.json。書き出し前の比較用Studioプレビューを別ポート3020で稼働。無音版は3019で保持。新しいMP4は未書き出し。
