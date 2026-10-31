# Issue #99: 実プレイヤー付き観戦テストの開始同期

## 調査と変更根拠

`play-confirmation.spec.mjs` の実プレイヤー準備は、DOT WAVEの
`main[data-phase=intro]` と残高だけを待っていた。`MochiDuel` は接続前にも
introを描画し、`joinedCabinet` / `roleChanged` でコントローラーがrevisionを
更新してゲームを再マウントする。introだけではプレイヤー席の確定を保証しない。
またSpaceのkeydownで確認を開くと、ダイアログのキャンセルへ自動フォーカスが
移るため、keyupによるネイティブボタン動作との競合もある。

今回の失敗と同じ操作をこのsandboxで再現することはできなかった。
上記はコードから確認した同期不足と入力上の競合候補であり、失敗画像だけから
特定の原因を確定したものではない。アプリの認可・会計処理は変更していない。

観戦準備のDOT WAVEプレイヤーは「あなたの筐体」と開始ボタンの表示・有効化を
待ち、描画済みボタンをクリックする。reserve/captureの待機は開始操作前に登録し、
両方の実応答、予約残高0、1回ずつのPOST、releaseなし、実phase、永続残高の
1消費を確認してから観戦者へ進む。DOT WAVEでは実startSolo認可応答
`dotWaveSoloStarted` も確認する。3ゲームのキー開始・キャンセル・遅延/重複操作と
観戦者の消費0の既存検証は維持する。

実プレイヤーの会計リクエストパス/HTTP状態、接続開始/切断、参加/席変更/
開始応答のイベント名、最後のphaseは `local-player-start` 添付へ保存する。
再接続は新しいsocketと参加イベントとして観測できる。認証情報・フレーム本文・
ゲスト情報は記録しない。通信は既存のローカル限定境界を維持する。

## マージ前の検証

- `node --check apps/web/tests/ui/play-confirmation.spec.mjs`: 成功。
- focusedブラウザ反復コマンド（desktop/mobile各5回を指定）:
  `node ci/node_modules/@playwright/test/cli.js test --config ci/ui-local.config.mjs play-confirmation --grep 'dot-wave: spectator.*live player' --repeat-each=5`
  はPlaywright未配置（MODULE_NOT_FOUND）で起動不能。反復結果なし。
- `npm run test:dot-wave`: ローカル待受 `listen EPERM 127.0.0.1` で停止。
- `npm test`: 同じローカル待受制限で停止。通常テスト一式の合格は未確認。
- `npm run build:staging`: 成功。Wranglerのログ保存先への書込警告あり。

依存関係の追加やsandbox制限の回避は実施していない。独立Web checksで
focused反復と通常CIを確認する必要がある。安定性の実証は未完了。

## マージ後の受け入れ（未実施）

独立レビュー、developへのマージ、実マージSHA初回CI、既存のstaging承認後の
公開・回帰、#91の公開後受け入れ、IssueへのPR/SHA/CI/公開証跡の記録は
この実装sandboxでは実施していない。ビルド成功を公開完了とは扱わない。
