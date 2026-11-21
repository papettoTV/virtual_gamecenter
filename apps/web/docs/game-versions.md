# ゲームバージョン

各ゲームを独立した正の整数で管理し、画面右下に小さく `v1` の形式で表示します。初期値の1は、この管理方式への移行時点を指します。以前の開発用バージョンとの大小関係を意味しません。

更新PRでは、ゲームを変更したときだけ対象の番号を1増やします。

```sh
npm --prefix apps/web run game:version -- buzz-barrier
npm --prefix apps/web run game:version -- dot-wave
npm --prefix apps/web run game:version -- deep-sea-salvage
```

番号はコミットに含めます。実行時刻・ビルド回数・デプロイ回数では変えません。並行PRはマージ前に最新developと照合して番号の重複を解消します。

データの正本は `src/domain/game-versions.json` です。`GameDefinition.currentVersion` は文字列に変換して既存のAPI・プレイ結果へ渡します。過去の結果の旧バージョンは変更せず、新規結果だけ新しい番号になります。ランキングの区切りや過去データの移行は行いません。

ゲーム領域の右下表示はプレイと観戦に共通です。クリックを受けず、スマホの全画面表示にも残ります。DOT WAVEは専用のゲーム盤面に、それ以外は共通ゲーム枠に表示します。
