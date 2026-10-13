# 無料ベータのCloudflare費用・利用量通知

更新：2026-10-14。アカウント全体の予算通知3件・R2利用量通知3件を設定済み。通知は請求上限・自動停止ではない。

## 方針と監視範囲

- 小規模ベータの初期条件として、アカウント全体の従量料金をUS$5 / US$10 / US$20の3段階で監視する。これは支出を承認する予算ではなく、調査を始めるための閾値。
- 検証・本番は同じCloudflareアカウントに属するため、通知は両環境と他プロジェクトを合算する。メールだけでPULBASEの費用と断定せず、サービス別内訳を確認する。
- 現在のWorkersはFree。通知のためにPaidへの変更、新規有料サービス、外部Webhookや監視Workerの追加は行わない。
- 通知先は運営者のCloudflare登録メール。個人のメールアドレスや認証情報は資料・Gitに保存しない。

## 設定条件

| 通知名 | 条件 | 初動 |
| --- | --- | --- |
| PULBASE beta - spend USD5 | 請求期間内の従量料金がUS$5を超える | 翌営業日までにサービス別・日別の増加を確認 |
| PULBASE beta - spend USD10 | 同US$10を超える | 当日中に原因と増加速度を調査、必要なら公開範囲縮小を判断 |
| PULBASE beta - spend USD20 | 同US$20を超える | 気づいた時点で調査、不要処理・異常アクセスを抑制。新規プレイ停止等は別途判断 |
| PULBASE beta - R2 storage 8GB | R2の総ストレージが8,000,000,000 bytesを超える | バケット別の増加・保存期間を点検。削除証跡を安易に削除しない |
| PULBASE beta - R2 class A 800k | R2 Class A操作が800,000回を超える | 書き込み・一覧取得・Cronのループや再試行を調査 |
| PULBASE beta - R2 class B 8M | R2 Class B操作が8,000,000回を超える | 読み込みの連打・重複取得・キャッシュを調査 |

R2の80%という基準はStandardの無料枠（10 GB-month、Class A 100万回、Class B 1,000万回）を参考にしたもの。ストレージ通知の「総バイト数」は請求上のGB-monthと同じではないため、8 GBを80%の厳密な請求判定と扱わない。Infrequent Accessにはこの無料枠が適用されない。

## 通知の限界

- 予算通知は従量料金だけを対象とし、Workers Paid等の固定月額、ドメイン代、税を含む請求総額とは一致しない。
- 予算通知は前日の利用量を日次集計した後に送られる。急増をリアルタイムで止める仕組みではない。
- 各予算通知は閾値到達時に1通送られ、次の請求期間でリセットされる。3段階を別通知として設定する。
- 現在のUsage based billing選択肢はR2 Storage / Class A / Class Bの3種類。Workers・D1・Durable Objectsの利用量通知を設定済みとはしない。
- アカウントの通知設定とメールの実着信は別の確認事項。費用を発生させるための負荷試験は行わない。

## Workers・D1・Durable Objectsの追加監視候補（未設定）

Free枠の80%を早期確認、95%を緊急確認の初期目安とする。日次枠はCloudflareの集計日境界に合わせ、日本時間の日付と混同しない。

| 指標 | 早期確認 | 緊急確認 |
| --- | ---: | ---: |
| Workers日次リクエスト | 80,000 | 95,000 |
| D1日次読み取り行数 | 4,000,000 | 4,750,000 |
| D1日次書き込み行数 | 80,000 | 95,000 |
| D1ストレージ | 4 GB | 4.75 GB |
| Durable Objects日次リクエスト（課金換算値） | 80,000 | 95,000 |
| Durable Objects日次実行時間 | 10,400 GB-s | 12,350 GB-s |

生のWebSocketフレーム数とDurable Objectsの課金換算リクエスト数を混同しない。無料枠に到達すると費用ではなくサービス継続への影響があるため、料金通知だけでは不十分。別途、利用可能なCustom alert/Analytics APIの指標・権限・追加費用を確認して自動通知を設計する。未実装の毎日の手動確認を「自動監視済み」とは扱わない。

## 受信後の手順

1. CloudflareのBilling > Billable Usageで、通知対象の請求期間とサービス別増加を確認する。
2. Workers・D1・Durable Objects・R2の画面で、検証/本番/旧プロジェクトを切り分ける。アクセス数・429・WS切断数・Cron失敗も見る。
3. 正常な利用増なら閾値やプラン変更を運営者が判断。異常なら原因の処理・アクセスを絞る。通知を無効化するだけで解決扱いにしない。
4. データ・削除証跡は保護し、支払い方法削除やリソース削除を費用対策として即実行しない。
5. 原因、対応時刻、変更、利用量の減少を記録する。初週の実測後に閾値を再評価する。

## 設定・検証記録

- 2026-10-14：設定前に通知未設定、Workers Free、R2の3指標とBilling budget alertが選択可能であることを確認。
- 運営者の承認後、Cloudflare登録メールを各通知へ入力して保存。全6件がEmail / Enabledになったこと、編集画面を再取得して各閾値が保存されていることを確認した。
- US$5予算通知とR2容量通知について、Actions > Test > Confirmからサンプル通知の送信操作を実施した。メールの実着信は未確認。運営者が受信箱・迷惑メールを確認して完了させる。閾値超過による実通知を発生させる負荷試験は行っていない。
- アプリのソース・プラン・課金契約・本番リソースは変更していない。アカウント全体の通知設定は検証/本番の両方に適用される。
- EN-04全体は分散乱用対策、Workers/D1/DOの自動利用量監視、実機負荷確認等が残る。通知設定済みと包括的な監視完了を区別する。

| 通知 | Policy ID | 保存後の閾値 | 状態 |
| --- | --- | ---: | --- |
| R2 Class A | `2c03f8cfc38045d782a990174c448bd6` | 800000 | Enabled |
| R2 Class B | `d0d6e33bdf9046f6b3945362dfe21ec1` | 8000000 | Enabled |
| R2 Storage | `c6f09e673b334b7695d236ab098db89b` | 8000000000 bytes | Enabled |
| 予算US$5 | `ada4fe2c64224ee8a82abf2ffa85aea4` | 5 USD | Enabled |
| 予算US$10 | `2cde2a9c383f4f9185fdbc4dc74eb4a2` | 10 USD | Enabled |
| 予算US$20 | `9d015530031b4c198c3fd2af9b08691d` | 20 USD | Enabled |

管理画面はCloudflare > Observability > Alerts > Overview。今後は上記通知を更新し、同じ条件の通知を重複作成しない。

## 公式資料

- [Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)
- [日次集計・固定料金除外の説明](https://developers.cloudflare.com/changelog/post/2026-06-15-budget-alerts-default-on/)
- [Usage-based billing](https://developers.cloudflare.com/billing/understand/usage-based-billing/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
