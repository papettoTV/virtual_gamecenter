# PULBASE C — BGM比較版

- 無音版は `../cut`、BGM版はこの `cut-bgm`。
- `assets` は `../cut/assets` を参照する相対シンボリックリンク。両フォルダを一緒に保持。
- BGM素材は `.media/audio/bgm/sun-in-your-eyes.mp3`。元URLは `bgm-provenance.json`。Gitでは音源単体を再配布しない。
- 曲：Sun in Your Eyes — Alejandro Magaña (A. M.) / Mixkit。
- 音量エンベロープは `index.html` の `bgm-sun-in-your-eyes`。無音版のHTMLへは追加していない。
- `npx hyperframes preview --background --no-open --port 3020` で比較版を開く。
