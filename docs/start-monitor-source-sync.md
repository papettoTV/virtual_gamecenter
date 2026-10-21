# 開始応答監視ソースの検証環境照合

2026-10-21、未push差分のIssue #18を専用PRで扱う前に、検証環境を読み取り照合した。負荷試験、DB変更、監視再デプロイ、通知条件保存、障害注入・メール再送は行わない。

## 読み取り結果

- 対象D1は `pulbase-staging`。0023_start_slo_alerts.sqlの適用履歴、start_slo_alert_buckets/configの2テーブル、requested/resolved/deletedの3トリガーが存在した。SELECTのみで書込0行。移行再適用は不要。
- 既存監視Worker `pulbase-service-monitor` の稼働versionは `ade17159-0397-4525-ad7a-014a001c2627`。これは[前回の停止・復旧訓練](monitor-cron-staleness-drill.md)で基準設定へ復元したversionと一致した。
- versionメタデータにはMONITOR_ENVIRONMENT=staging、START_SLO_ENABLED=true、START_SLO_DBと既存のAE/KV/service/Secret名が存在した。停止/集計障害用の一時変数・bindingは残っていなかった。Secret値を取得・表示していない。

この照合は既存の監視導入・復元の記録と現在のversion/設定の一致確認であり、今回新たに障害を発生させた試験でも、監視Workerのソース全体をバイト単位で比較した証明でもない。以前の実発報・Resolvedメールは各訓練資料を参照し、今回再受信したとは報告しない。

## 今回のGit統合と確認範囲

0023・保持処理、コード9/10の監視処理、期限付き訓練ガード、SQL照合スクリプト、テストと手順を最新developへ取り込む。関連する移行が検証D1に存在するため、通常アプリの保持処理を反映する前提を確認できた。通常アプリのWorker/Pagesの実SHA・HTTP/ブラウザ検査はdevelopのCI/CDで別途確認する。

独立監視Workerと通知条件は既存の稼働状態を維持する。今回はGitと既存検証設定のずれを減らす変更であり、監視Workerの再デプロイが必要になった場合は設定を再照合して別途実施判断する。main・本番・負荷試験は未変更、長時間負荷試験の保留・未合格は維持する。
