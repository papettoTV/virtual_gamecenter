# Issue #128: 一覧への直接退出

## 現行コードの調査

- BUZZ BARRIER (`graze-duel`) と DEEP SEA SALVAGE (`deep-sea-salvage`) は共通 `GameScreen` を使う。旧 `leave-game.ts` は document の capture 段階で `#game-back-to-arcade`、`#ranking-another-game`、`.mobile-play-leave` を捕捉していた。
- 旧確認の対象は player の ready / playing / paused 等（finished 以外）。finished、spectator、コンテキストなし、DOT WAVE の ready は確認不要だった。BUZZ のスマホ全画面中は一時停止時に退出ボタンが出る。結果画面には「別のゲームを探す」がある。
- DOT WAVE は独自 UI を使用し、ヘッダーの「ゲーム一覧へ」と結果の「別のゲームを探す」は旧捕捉セレクターに該当しない。もともと追加確認なしで退出する。
- 入場時点では消費しない。共通 `PlatformExperience.handlePlayConfirm` → `executePlay` は開始確認の承認後、reserve → capture → `gameHost.play` の順で処理する。開始前の確認取消では予約しない。リトライも共通認可経路を使う。
- DOT WAVE は `cabinetController.beforeSolo` で reserve → capture → `startSolo` を送る。終了後は `soloEnded` が次回開始の課金状態を戻す。いずれも一覧への退出を消費の契機にはしていない。「退出後の遷移時に消費へ変更された」という報告とは異なる。
- 予約時は available が減り reserved に入り、capture で消費確定する。Worker の `validatePlayReservation` は所有者・筐体・ゲーム・消費台帳等を検証して使用を記録する。active の解放と、まだ使用認可されていない capture の返却は既存処理が扱う。`refundUnusedCapture` は使用記録済みを返却しない。これらの処理は変更していない。

## 変更と維持する処理

確認専用の document リスナーと App の登録を削除した。確認を前提にした単体テストは、実 UI とローカル会計 API を使うブラウザ回帰ケースに置き換えた。

各ボタンの既存遷移、共通 `CabinetDirectory` の退出、App の `CanvasRuntime` アンマウント時の instance / lifetime dispose、各ゲームの cabinet leave、DOT WAVE controller の dispose は維持する。`useMobilePlay` の cleanup による body style・inert・スクロール位置・フォーカス復帰も維持する。アプリケーション内に Fullscreen API の呼び出しはなく、今回の対象は既存の代替全画面表示である。消費・返却・認可・バックエンドの変更はない。

## マージ前検証

- `tests/ui/play-confirmation.spec.mjs` に、各ゲームの開始前退出・別ゲーム入場・開始承認後退出・連打・同一筐体再入場・観戦退出を追加。実財布の残高、予約/capture/release の回数、退出前から存在する WebSocket の切断、live context 解消、全画面・body style・inert 復帰を検証する。既存の開始取消・承認・遅延二重入力・capture 失敗テストも維持する。desktop / mobile は独立 CI の既存プロジェクトで実行する。
- `node --check apps/web/tests/ui/play-confirmation.spec.mjs` と `git diff --check` は成功。
- focused Vitest（play-service、graze-duel-lifecycle、DOT WAVE cabinetRouteLifecycle）と `apps/web` の `npm test` はローカル Worker 起動時の `listen EPERM 127.0.0.1` で停止した。テスト成功とは扱わない。Wrangler のログディレクトリ作成制限の警告も発生した。
- `apps/web` の `npm run build:staging` は終了コード 0。型検査・Vite・Pages 成果物生成まで成功（チャンク容量の警告あり）。デプロイはしていない。
- ブラウザ実行に必要な Playwright とローカル待受環境はこのサンドボックスでは利用できず、新規ブラウザケースはここでは未実行。終了後の結果ボタンからの実操作、実端末でのスクロール・通常操作の復帰、リトライ後の退出、予約進行中の退出競合も未確認。既存の Worker 会計・認可テストは変更していないが、今回の実行では結果を得られていない。

## マージ後の受け入れ確認（未実施）

独立 CI のブラウザ・会計テスト成功後、人の staging 承認に従って develop のデプロイ SHA と修正 SHA を照合する。PC / スマホの各ゲームについて開始前・プレイ中・一時停止・終了後・観戦・連打・再入場・別ゲーム開始を確認し、使用済みクレジットが戻らず新しい開始だけが課金されることと、残予約なし・接続終了・通常表示への復帰を確認する。Issue への日時・端末・ブラウザ・結果・証跡リンクの記録、Issue のクローズ判断は未実施。main / 本番への操作は行っていない。
