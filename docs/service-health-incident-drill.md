# 死活監視のDOWN・RECOVERED総合訓練

更新日: 2026-10-20

## 目的と範囲

既存の5分Cron、2回連続失敗/3回連続正常の状態遷移、Analytics Engineの集約SQL、既存メール通知を通した訓練。Test送信や集計値の直接書き込みは使わない。

通常の検証Pagesやゲームを停止せず、監視Worker内の非公開Service Bindingだけで実際のHTTP 503を発生させる。これは**監視の障害検出・復旧経路の訓練**であり、公開Pages全体の停止、Cloudflare全体の障害、アプリのロールバックやD1復元の証明ではない。自然障害と混同しないよう、訓練中の集約記録を`controlled-http-drill-v1`で識別する。

対象は`pulbase-service-monitor`のみ。本番/main/DNS、通常のアプリWorker、D1/DO/残高、既存通知ポリシー、Cron間隔、保存済みBasic認証Secretは変更しない。負荷試験は保留のまま。

## 安全策

- 公開HTTP入口は404のまま。workers.dev・preview URL・routesを追加しない。
- 操作はCloudflare認証済みの私有RPC `HealthDrillOperator`のみ。環境はstaging固定、対象URLや日時はCLIから指定できない。
- 事前に直近10分以内の正常3回・障害なしを要求する。既存の実障害中には開始しない。
- 503応答は開始から最長20分で自動停止。手動`recover`で早く戻せる。訓練の識別期間は1時間、KVにも期限を設定する。プロセスが落ちても恒久的な503にならない。
- 通常の7項目の検証Pages監視も必ず継続する。訓練経路が正常でもPagesが異常なら復旧にしない。
- 私有HTTPの送信先は`https://health-drill.invalid/probe`だけ。Basic認証やCookieを転送せず、外部ネットワークではなくService Bindingで呼び出す。応答の200と固定識別ヘッダーを両方確認する。
- 状態や時刻を直接正常化しない。既存の自然Cronで正常3回を観測して初めて復旧する。KVの訓練キーを消す`finish`も、直近の正常3回・故障解除を要求する。
- KVは強整合ロックではない。複数運営者での同時開始・コマンド連打は行わない。後続の状態照合と期限による安全復帰を前提にする。
- 異常な訓練設定やKV/Binding障害では正常heartbeatを捏造しない。監視の記録欠落として切り分ける。

## 手順

作業ディレクトリは`apps/web`。CLI認証が必要。秘密値はコマンド引数・資料・チャットへ出さない。

1. `node scripts/health-drill.mjs --environment staging status`で正常・訓練なしを確認する。
2. `node scripts/verify-service-health.mjs --environment staging status`で実集約値と予定スロットを確認する。読み取り専用APIトークンは管理外の`.dev.vars`にある既存`CLOUDFLARE_METRICS_TOKEN`を使用する。
3. `node scripts/health-drill.mjs --environment staging start`を1回実行する。出力される開始・故障期限・訓練期限を記録する。
4. 自然Cronの2回連続503を待つ。`verify-service-health.mjs --environment staging down`で障害状態とSQL値1を確認する。手動scheduled呼び出し・AE点の直接書き込み・通知Testはしない。
5. 登録メールに届いた通知本文の`Trigger: 1 >= 1`と発報開始時刻を確認する。通常のプレイを止めた証拠にはしない。着信待ちだけのために503を延長せず、SQLで障害を確認したら次の解除へ進んでよい。監視の障害状態は正常3回まで維持される。
6. `node scripts/health-drill.mjs --environment staging recover`を1回実行する。以後、私有HTTP応答も200になる。
7. 自然Cronの3回連続正常を待つ。`verify-service-health.mjs --environment staging recovered`で正常3回・復旧時刻・SQL値2を確認する。
8. `node scripts/health-drill.mjs --environment staging finish`を実行し、訓練キーなしを照合する。次の自然Cronが`normal`になることを確認する。復旧時刻は消さず、通知表示を維持するため、訓練終了をメール着信まで引き延ばす必要はない。
9. 通知の15分再通知間隔と取り込み遅延を考慮し、メール本文`Trigger: 2 >= 1`を確認する。これは状態コード2の復旧通知であり、閾値を下回ったときの`[Resolved]`メールとは別。SQL値が復旧表示の30分後に0へ戻ることも確認する。メール到着時刻だけで復旧通知と判定しない。
10. 通常の読み取り疎通と、今回分のテスト/ビルド/CIを確認して記録する。

期待する最低待ち時間は、自然Cronの位相により失敗2回で約5〜10分、解除後の正常3回で約10〜15分。メールはさらに評価・取り込み・再通知・配送の遅延がある。即時・exactly-onceは保証しない。

## 費用・利用量

新しいCron、KV namespace、Analytics Engine dataset、通知枠は作らない。通常時の追加は訓練キー確認のKV読み取り1回/5分（288回/日）。既存の状態読み取りと合わせ通常576読み取り/日、状態書き込み288回/日の目安。訓練中だけ私有HTTPと追加KV読み取りが各1回/5分、開始・解除・終了の数回のKV操作が増える。監視の通常HTTP最大2016要求/日は変えない。無料枠内の保証・上限拡大・課金契約の変更はしない。

## 今回の実施記録

監視Worker最終版: `e63b4379-d8f1-4cf7-8943-a292227c9d41`。既存KV/AE/Secret/Cronと通知を維持してデプロイした。HTTP状態と通常Pagesの正常を別指標にした最新版へ、訓練中に1回更新した。KVの履歴・予定スロット・障害状態はリセットしていない。

| 確認 | 結果（UTC、日本時間は+9時間） |
| --- | --- |
| 事前正常 | 07:03、訓練キーなし、最新07:00スロットは正常3回、障害なし・集約値0 |
| 訓練開始 | 07:03:28。故障期限07:23:28、訓練期限08:03:28 |
| 自然Cronの失敗 | 07:05が失敗1回、07:10が失敗2回でDOWN。07:13:42のSQL照合で隔離HTTP 503、通常Pages正常、集約値1 |
| 故障解除 | 07:17:30にrecover。監視状態や復旧時刻は直接書き換えず、自然Cronを待つ |
| 通常ページの維持 | 07:17:57、HTML・JS・3ゲーム一覧・規約の7検査すべてHTTP 200。合成プレイヤー/残高/WSを作らない読み取り検査 |
| DOWN実着信 | 07:19:23（16:19:23 JST）、`Trigger: 1 >= 1 (Threshold)`。発報開始07:15:57。Test送信ではない |
| 自然Cronの復旧 | 07:20・07:25・07:30が正常3回。07:31:54のSQL照合で隔離HTTP 200、通常Pages正常、障害なし、復旧時刻07:30、集約値2 |
| 訓練終了 | 07:35:35にfinish成功。07:35:39のRPCで訓練キーなし・正常3回・障害なし。復旧時刻は保持 |
| 通常モード復帰 | 07:41:47のSQL照合で自然Cronの最新07:35スロットがnormal、通常Pages正常・障害なし。07:50:46の最新07:45スロットでもnormal維持、集約値2 |
| RECOVERED実着信 | 07:50:20（16:50:20 JST）、`Trigger: 2 >= 1 (Threshold)`。発報開始07:46:57。Test送信ではなく、値1のDOWN通知とも別に本文照合 |
| 復旧表示の終了 | 08:02:18のSQL照合で最新08:00スロットはnormal・通常Pages正常・障害なし、集約値0。復旧表示30分の自然終了を確認 |
| 終了後の通常疎通 | 08:02:19、7検査すべてHTTP 200。訓練中・終了後とも通常のアプリ、3ゲーム一覧、規約を維持 |

最初のDOWN読み取りはAE取り込み前で未成立だった。KVでは07:10の障害状態を確認でき、取り込み後にSQL値1と照合成功した。早い読み取り失敗を実障害/復旧の証拠にせず、KV・AE・メールの時刻を分けて記録する。初回07:05のポイントはHTTP状態の追加前の版のため、503と通常Pages正常の判定には07:10以降のポイントを使った。

07:34:24着信の再通知は、07:30:57時点の`Trigger: 1`だった。監視が07:30に復旧してもAE取り込みと評価・メール配送は別時刻であることを実証した。これを復旧メールと誤認せず、後続の`Trigger: 2`を確認した。SQLで復旧確認後は先に訓練キーを解除しており、復旧表示時刻を変更して通知を偽造していない。

公開対象の監視Workerバンドルは、元の作業ツリーでデプロイした版とバイト一致することを確認。公開対象ツリー715テスト、型検査・stagingビルド・監視Workerコンパイル成功。元の作業ツリーは未公開の別作業を含む764テスト成功であり、公開対象と区別する。既存の500kB超チャンク警告は残す。GitHub CI・PagesのGit連携と、専用監視Workerのデプロイは別経路として扱う。

以上の範囲は完了。実サービス全体の停止、開始/ログイン/付与の失敗率集計、本番監視、Cloudflare外からの独立監視、運営者による公開判定は残す。長時間負荷試験は保留・未合格を維持する。

## 関連資料

- [無料ベータ運営手順](beta-operations-runbook.md)
- [失効RPCの運用手順](session-revocation-operations.md)
- [アイドル接続失効・通知の総合訓練](idle-session-revocation-drill.md)
- [公開前チェックリスト](production-launch-checklist.md)

基盤仕様: [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)、[非公開Service Binding RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)。
