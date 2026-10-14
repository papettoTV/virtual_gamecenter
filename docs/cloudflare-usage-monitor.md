# Workers・D1・Durable Objectsの利用量自動通知

更新：2026-10-14。無料ベータ用のアカウント利用量監視。自動停止や支払い上限ではない。

## 構成

1. 検証Worker `pulbase-staging` の15分Cron（`0,15,30,45 * * * *`）でGraphQL Analytics APIを読み取る。
2. UTC当日のアカウント全体利用量とストレージを集計し、Analytics Engine `pulbase_account_usage` に1点保存する。
3. Cloudflare Custom Alertsで無料枠に対する最大使用率を評価し、運営者の登録メールへ通知する。

同じアカウントの検証・本番・旧プロジェクトを合算する。WorkersにはPages Functionsも加算する。リソース別の詳細はCloudflareダッシュボードで調査する。監視は検証Workerだけで実行し、本番で重複実行しない。検証Workerを停止・廃止する際は監視の移設が必要。

既存の毎時データ削除Cronは維持し、15分監視Cronでは削除を実行しない。本番・ローカルの毎時Cronも変更しない。通常のプレイ・観戦APIから利用量APIを呼ばない。公開する監視実行用HTTPエンドポイントも追加しない。

## 通知条件

| 通知 | 判定 | 評価・再通知 |
| --- | --- | --- |
| `PULBASE beta - usage 80 percent` | 9指標の最大使用率が80%以上 | 15分ごと、継続中は6時間ごと |
| `PULBASE beta - usage 95 percent` | 同95%以上 | 15分ごと、継続中は6時間ごと |
| `PULBASE beta - usage collection failed` | 過去30分に取得失敗が1件以上 | 15分ごと、継続中は1時間ごと |
| `PULBASE beta - usage heartbeat missing` | 過去60分の監視データが0件 | 15分ごと、継続中は1時間ごと |

失敗と停止も検知するため、トークンの期限切れ・権限不足・Cron停止・無料枠到達による監視Worker停止を「利用量ゼロで正常」とは扱わない。通知の評価窓は15分、SQLはManualモード。高使用率は直近30分の最新正常スナップショットを使い、取得失敗や無通信は別通知で扱う。

### 通知SQLの復元

Custom SQLに以下を設定し、`<ACCOUNT_ID>` は `wrangler.jsonc` の `account_id` に置き換える。送信先はCloudflare登録メール。いずれもManualモードで実行する。

80%・95%の2通知（演算子 `>=`、閾値80/95）:

```sql
SELECT argMax(double10, timestamp) AS value
FROM events.analyticsEngine.pulbase_account_usage
WHERE accountTag = '<ACCOUNT_ID>' AND blob2 = 'ok'
AND timestamp >= NOW() - INTERVAL '30' MINUTE
```

取得失敗（演算子 `>=`、閾値1）:

```sql
SELECT count() AS value
FROM events.analyticsEngine.pulbase_account_usage
WHERE accountTag = '<ACCOUNT_ID>' AND blob2 = 'error'
AND timestamp >= NOW() - INTERVAL '30' MINUTE
```

60分停止（演算子 `<=`、閾値0）:

```sql
SELECT count() AS value
FROM events.analyticsEngine.pulbase_account_usage
WHERE accountTag = '<ACCOUNT_ID>'
AND timestamp >= NOW() - INTERVAL '60' MINUTE
```

初回導入は1点以上の取り込み確認後に停止通知を有効化する。新規Cronの伝播とAnalytics Engine取り込みには遅延がある。SQLの0という結果だけでは取得成功と判定せず、`blob2 = 'ok'` の実レコードを確認する。

## 監視指標と初期閾値

| 順序 | 指標 | 80% | 95% |
| --- | --- | ---: | ---: |
| double1 | Workers＋Pages Functions日次リクエスト | 80,000 | 95,000 |
| double2 | D1日次読み取り行数 | 4,000,000 | 4,750,000 |
| double3 | D1日次書き込み行数 | 80,000 | 95,000 |
| double4 | D1ストレージ（直近24時間のDB別ピーク合計） | 4 GB | 4.75 GB |
| double5 | DO日次実イベント数（安全側の早期警告） | 80,000 | 95,000 |
| double6 | DO日次実行時間 | 10,400 GB-s | 12,350 GB-s |
| double7 | DO SQLite日次読み取り行数 | 4,000,000 | 4,750,000 |
| double8 | DO SQLite日次書き込み行数 | 80,000 | 95,000 |
| double9 | DOストレージ（直近24時間のnamespace別ピーク合計） | 4 GB | 4.75 GB |

残りのdouble10は最大使用率、double11はDOの課金換算リクエスト推定、double12は取得時刻のUnix秒。blob1はUTC日付、blob2はok/error、blob3はスキーマ版v1。ユーザー名、個人ID、IP、セッショントークン、APIトークン、個々のDB/DOの識別子は保存しない。

日次枠はUTC 00:00（日本時間09:00）から取得時刻まで。ストレージは同じデータを時間ごとに重複加算せず、DB/namespaceごとの最大値を合算する。各リソースのピーク時刻が異なるため現在値より多く出ることがあり、安全側の判定である。

DOのWebSocketは課金上20メッセージを1リクエストへ換算するが、Analyticsは実数。hibernationイベントと通常接続の受信メッセージを区別し、推定値をdouble11へ保存する。警告は実イベント数を用いるため課金換算値の到達より早く出る場合がある。単なるフレーム数を課金リクエスト数と表記しない。

## 秘密情報と環境

- `CLOUDFLARE_METRICS_TOKEN` は対象アカウントのAccount Analytics Readだけを持つ専用トークン。検証WorkerのSecretに保存し、vars・ソース・ログ・Gitへ含めない。
- ローカルでは監視を無効化。本番Workerも監視を無効化し、アカウント全体を一箇所から監視する。
- デプロイ前の設定検査で、アカウントID、Secret宣言、dataset、15分Cron、重複実行、ビルド成果物の環境取り違えを検査する。
- API通信は10秒で打ち切り、本文上限256 KiB。部分エラー、欠落、負の値、不正形式、グループ打ち切りの可能性を拒否する。外部APIのエラー本文や秘密値はログに出さない。

## 利用量・費用と対応

通常は監視96回・Analytics Engine書き込み96点/日。通知4件を15分ごとに評価するため約384クエリ/日を目安とする。ダッシュボードのプレビュー・テストは別途加算される。無料枠・料金は変更され得るので、プラン変更時やベータ利用増加時に再確認する。Workers Paidへの変更は行っていない。

APIのサンプリング・取り込み遅延により、厳密な現在使用量・請求額ではない。短時間の急増を止めるものではなく、メール着信の遅延もある。80%では当日中に内訳と増加速度を点検、95%では新規プレイ制限等を運営者が判断する。自動削除や自動課金プラン変更は実装しない。

失敗通知ではトークンの有効期限・権限・Secretを、停止通知ではCron・Worker利用枠・Analytics Engine配信を確認する。トークン更新後は次の正常スナップショットが届くことを確認する。課金料金の予算通知やR2の既存通知は維持する。

## 検証記録

- 全516テスト・型検査・ビルド成功。UTC境界、Pages合算、ストレージ重複排除、DO換算、不正/部分応答、本文上限、秘密情報を含めない失敗記録・リダイレクト拒否・Cronの保守/監視分離・継続実行検査をテスト。
- 専用トークンで9指標の実API取得成功。Workers＋Pagesの実測使用率は約18.896%。
- Analytics Engine利用開始は運営者が実施。検証Workerへ反映し、本番Worker・本番DBは変更していない。
- Cloudflareランタイムが `redirect: "error"` を受け付けない問題を実プレビューで特定し、`manual` とHTTPステータス確認へ修正。別ホストへトークンを転送しないまま正常取得を確認。
- 検証Workerへ監視処理を反映。保守復元後の版は `c7477402-6234-45ad-a03e-9b8cc8bcb307`。通信修正後の実Pagesで3ゲームの開始・ライブ観戦・対戦/再戦・不正な予約拒否・未開始返却を再確認。
- 4通知は登録メール宛・Enabledで保存済み。80%通知のTest操作を実施。受信箱への実着信は運営者確認待ち。実負荷を80%/95%まで増やす試験は実施せず、境界値はテストで検証。
- 検証プレビューの予定実行で、実API取得→Analytics Engine保存→通知SQLの使用率19.115%を確認。取得失敗点も正常な0と区別して保存できることを確認。
- **15分Cronの自動配信確認済み。** 2026-10-14 12:00 JSTから20:15 JSTまで、監視Cronの34回の実行履歴はすべてsuccess。12:00〜20:00の正常スナップショット33件を照合し、15分間隔で欠落なく取得・保存されていることを確認。今回の再開後は再デプロイや手動予定実行を行っていない。毎時保守Cronの成功も履歴で確認。
- 管理APIには2026-10-14 10:05:54 JSTの登録更新がある一方、新しいCronの初回実行は12:00:12 JSTだった。先の不一致は登録面と配信面の初期反映遅延と整合するが、Cloudflare内部の遅延原因は断定できない。コードの非対応redirectとは別問題であり、正常化後に無用な再登録・再デプロイは行わない。旧毎時Cronの重複した実行履歴も残っているため、登録APIだけを見て配信・削除完了と判断しない。

## 再検証の手順

`apps/web` で `npm run monitor:verify` を実行する。`.dev.vars` または環境変数の専用読み取りトークンでSQLを実行するだけで、Cloudflare設定・DB・通知は変更しない。トークンやAPI応答全文も出力しない。

- 最新4点について、正常状態・9指標・予定時刻付近・15分間隔・最新データの鮮度を検査する。
- 空データ、単発の成功、失敗、欠落/重複、古いデータだけでは成功扱いにしない。
- 最新値が届くまで取り込み遅延があるため、35分以内を許容する。
- データの間隔検査だけで手動/自動を完全に識別するものではない。初回導入・障害解消時はCloudflareの `workersInvocationsScheduled` 履歴（対象scriptName/cron/status）と照合する。
- 登録が正しくても実行履歴・保存がない場合は公開完了としない。長い初期遅延が再発する場合は、登録更新/実行/保存の時刻を添えてCloudflareへ問い合わせる。監視を外す、秘密情報を公開する、Workerの有料プランへ変更する等の回避策は取らない。

| 通知 | 保存済みPolicy ID |
| --- | --- |
| 80% | `dcda89d46b1d4c81a6a8e13079ebcb61` |
| 95% | `a47467c61cc548e78ca14fe51999f647` |
| 取得失敗 | `ef8864fed1ac4dd4bfc45a2ddefac6e4` |
| 60分停止 | `0371c29d5597462b954801feef983347` |

## 公式資料

- [Cloudflare Custom Alerts](https://developers.cloudflare.com/notifications/notification-available/)
- [Analytics API token](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/)
- [Analytics Engineの開始手順](https://developers.cloudflare.com/analytics/analytics-engine/get-started/)
- [Analytics Engineの無料枠・料金](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)
- [DOのWebSocket指標](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/)
- [DOの課金換算](https://developers.cloudflare.com/durable-objects/platform/pricing/)
