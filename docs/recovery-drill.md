# 無料ベータのバックアップ・復元訓練

更新日：2026-10-20。EN-08 / DL-04の検証記録。負荷試験ではない。main、本番、既存の `pulbase-staging`、利用者のDB・R2・セッションは変更しない。

## 分離とガード

- 訓練用D1/R2を新設し、合成プレイヤー2人だけで実施する。実データのコピー・エクスポートは不要。
- D1/R2に同じ `pulbase-recovery-drill-YYYYMMDD` 名を使用する。本番・通常検証のDB IDとR2名を拒否し、D1の実メタデータの名前/IDも照合する。
- 公開URL・routes・Cron・Service Binding・DO・Secret・assetsを設定しない。Workerのデプロイはせず、ローカルの `getPlatformProxy` から明示したremote D1/R2 bindingだけを利用する。終了時にproxyをdisposeする。
- `scripts/recovery-drill.mjs` は既存の `processDeletion` / `replayDeletionAudit` をそのままバンドルして実行する。アプリに管理APIやテスト用公開ルートは追加しない。
- 筐体側の削除RPCは合成スタブ。本物のDO・WebSocket・停止切替・Google/Stripeはこの訓練の対象外。既存のDO削除テストと実機の確認を混同しない。
- 名前ガードを通るだけでは安全と判断しない。作成したリソースのIDを照合し、復元コマンドの直前にも専用DBを確認する。

## 再実施の手順

`apps/web` で実行する。新しい空の訓練用D1/R2を用意する。既に訓練済みのDBを初期化するコマンドは用意していない。

1. `config/recovery-drill.example.json` を `config/recovery-drill.local.json` にコピーする（Git対象外）。名前を新しい日付へ変え、同名のD1/R2を `wrangler d1 create` / `wrangler r2 bucket create` で作成する。D1 IDを実値へ置換する。例のIDでは実行できない。公開設定やアプリのbindingは変えない。
2. `npx wrangler d1 migrations apply DB --remote --config config/recovery-drill.local.json`。対象は新設DBだけ。
3. `npm run recovery:drill -- config/recovery-drill.local.json seed`。初期化済みの合成fixtureだけなら再開できるが、他のプレイヤーやR2証跡がある場合は拒否する。
4. `umask 077` のうえ、`npx wrangler d1 export DB --remote --config config/recovery-drill.local.json --output <Git対象外の一時SQL>` で合成データのバックアップを取得。期限付きダウンロードURLを含むWrangler出力は公開しない。SQLを独立DBへインポートし、外部キーと残高を照合する。SQLiteの場合は空DBで外部キー無効・単一トランザクション内で取り込み、その後有効化して `PRAGMA foreign_key_check` を実行する。
5. `npx wrangler d1 time-travel info DB --config config/recovery-drill.local.json --json` で削除前bookmarkを取得・保存する。
6. `npm run recovery:drill -- config/recovery-drill.local.json delete`。削除対象だけのセッション・公開結果・残高を削除し、独立R2にaccepted証跡が残ること、他人の残高/購入履歴が残ることを確認する。
7. `npx wrangler d1 info DB --config config/recovery-drill.local.json --json` で名前とIDを再照合する。`npx wrangler d1 time-travel restore DB --config config/recovery-drill.local.json --bookmark <手順5の値> --json` を実行。これは**指定DBを上書きする**。実サイトのDBに置き換えて実行しない。戻す必要がある場合に備え、応答の `previous_bookmark` も保管する。
8. `npm run recovery:drill -- config/recovery-drill.local.json verify-restored`。削除済みデータと古いセッションがD1に戻り、削除受付が消えた一方でR2証跡が残ることを確認。再削除前に公開してはいけない。
9. `npm run recovery:drill -- config/recovery-drill.local.json replay`。筐体削除RPCの失敗を模擬し、全削除対象のセッション失効・pending維持を確認。その後成功・再実行を確認し、他の合成利用者の残高・購入履歴を維持する。
10. `npm run recovery:drill -- config/recovery-drill.local.json finalize`。再削除完了後、復元された全利用セッション・再認証・削除確認を失効させる。削除対象以外の古いログインも復活させない。`verify-final` で再確認する。これは訓練専用DBだけに実行する処理であり、本番操作の許可ではない。
11. 結果と未確認事項を記録する。本番再開の承認は別途必要。専用リソースにCronや公開アクセスはないが、保存容量は残るため不要になった時点で対象IDを照合して片付ける。独立R2をTime Travelに合わせて巻き戻してはならない。

CLIは認証情報・合成データ本文を表示せず、結果のフラグだけを出す。失敗時は公開停止を維持し、ローカルで対象/状態を確認する。失敗したことを成功の証跡として扱わない。

## 2026-10-20の実測

| 項目 | 結果 |
| --- | --- |
| 対象 | D1/R2 `pulbase-recovery-drill-20261020`、D1 ID `d0a877ee-5a55-42c8-9777-65f905f1cf9c` |
| 移行 | 0001〜0021適用。既存検証/本番には未適用 |
| データ | 削除対象/存続対象の合成プレイヤー各1人、各セッション/公開結果/無料5枚。存続対象に合成購入5枚とpaid購入記録・台帳（Stripe通信0件） |
| 初期化 | 最初は同一ゲスト名の一意制約で停止。合成ゲスト名を一意に修正し、部分初期化済みfixtureを保護して再開。その後成功 |
| SQLバックアップ | 一時SQLを取得し、空のメモリSQLiteへトランザクションで取り込み、2人・購入残高5・外部キー違反0件を確認。実データのバックアップは取得していない |
| 削除前bookmark | `00000001-00000039-00005109-032939cf5efdaf34357ede9c92e025ad` |
| Time Travel | 削除後に上記bookmarkへ実復元成功。`previous_bookmark`: `00000001-ffffffff-00005109-d2c0f16b6b3168b7cbcc8f996bf24b6f` |
| 復元直後 | 削除対象のプロフィール・セッション・ランキングが復活、D1削除受付0件、独立R2証跡あり。公開経路なし |
| 再削除 | R2から受付を再構築。RPC失敗時にセッション0件・pendingを確認。再試行成功・2回目も成功、プロフィール/公開結果/残高の削除と受付completedを確認 |
| 存続対象 | 無料5枚・合成購入5枚・購入履歴1件・台帳2件を維持。finalizeで復元された全セッションを0件にし、最終確認も成功 |
| リソースの終状態 | 専用DB/R2は合成データと証跡だけを保持。proxyは終了、アプリ/Cron/公開ルートなし。R2のr2.dev公開無効・カスタムドメイン0件を読み取り確認。既存の検証・本番に影響なし |

ローカルの全656テスト・型検査・検証ビルド成功。ガードの5テストを追加。既存の大きいチャンク警告は残るが、ビルド失敗ではない。本手順追加によるアプリのデプロイ・本番変更・長時間負荷試験は実施していない。

## 本番相当の再開前に残る確認

- 実DOのデータ・接続状態を復元後DBと再照合する。DOの状態はD1のTime Travelでは戻らない。
- 書き込み停止・準備中ページへの切替と解除を、承認された環境で実際に訓練する。今回は公開経路のない隔離リソースで代替し、既存サイトを停止していない。
- 復元時点より後の付与・消費・予約・返金を別の証跡と照合する。ウォレットと台帳/仮確保を照合し、不一致がある間は開始を止める。Stripeを再開する将来はWebhook履歴と決済側も照合し、購入レコードを黙って消す/二重付与する復旧をしない。今回は合成購入の保持だけを確認し、実Stripeとの突合は未実施。
- 本番専用DB/R2の作成・非公開設定・権限・容量/費用通知と、実利用条件での復元時間を確認する。今回の成功を本番復旧時間や公開可否の保証にしない。
- 長時間の負荷試験は未合格のまま保留する。

参考：[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)。Freeでの保持期間などは実際の契約と公式の最新仕様で確認する。
