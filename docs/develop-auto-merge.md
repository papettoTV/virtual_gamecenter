# 自動Issueからdevelopマージまでの通常運用

## 実行経路

`実装:自動` だけを付けたIssue → GitHub Actions上のCodex実装 → 同じIssue用のPR作成 → 必須CIと独立Codexレビュー → 固定されたci-controlの証跡照合・develop保護確認 → 開発用Appでdevelopへsquashマージ → 同じ実マージSHAの初回push CI → ci-controlの公開処理が自動起動 → 人がstaging承認1回 → 検証公開1回・HTTP/ブラウザ回帰1回。

Issueへの自動ラベル付与、実装、PR作成、レビュー、developマージには追加承認を要求しない。自動実装workflowのIssueイベントはlabeledだけを購読し、作成時に自動ラベルを付けた場合のopened/labeled二重受付を防ぐ。既存Issueへの後付けも同じラベル付与で起動する。明示的な手動起動でもラベルと重複PR確認は必須。`実装:自動` がないIssueは手元実装とし、既存PRや担当を確認してチャットから扱う。`実装:手元` との併用は禁止する。公開なし試験ラベルのIssueは実マージしない。

## 有効化する設定

- `PULBASE_CODEX_ENABLED=true`。
- 新経路専用のRepository variable `PULBASE_DEVELOP_AUTO_MERGE_ENABLED=true`。未登録・falseなら自動マージしない。
- `PULBASE_CONTROL_EVIDENCE_ENABLED=true`、固定制御SHA `2c883a1cdd961510a0557742f74294739752f445` を維持する。
- 旧経路の `PULBASE_AUTO_MERGE_ENABLED` と `PULBASE_STAGING_DEPLOY_ENABLED` はfalseのまま。
- production・Xのフラグはfalseのまま。

automation Environmentに既存のpulbase-codex（App ID 5403155）の鍵を保管する。今回、新しい鍵や権限追加は不要。自動マージ用トークンはvirtual_gamecenterだけを対象に発行し、ジョブ終了時にActionが失効させる。release Appの鍵・Cloudflare鍵・OpenAIキーは自動マージジョブに渡さない。

## 信頼条件と保護

ci-controlは更新しない。レビュー信頼定義・候補照合・マージ処理は固定コミットから読み込み、PRコードや実装が生成したスクリプトは鍵のあるジョブで実行しない。初回の成功レビューrunに属するreceiptだけを取得し、レビュー対象head/base/candidate/treeと初回CI、成果物ID、レビュー定義25ファイルのGit blob、現在のdevelopを直前まで再照合する。

developの必須CIはGitHub Actions発行のverify / Automation control checksで、strict・管理者への適用を維持する。Appへの書込transportは同じPR・headのsquashマージだけを許し、main更新・別PR・workflow起動・設定変更を拒否する。マージ後のtree・親・developの実SHAも確認する。

ci-controlとmainのbypassは空、保護モードstrictのまま。固定した保護設定版から変更されたら停止する。設定版・制御SHAを今後更新するときは、人が保護設定と固定コードを確認して新起動側の固定値も更新する。自動マージの開始ジョブはautomation、実公開は人の承認が必要なstagingに分離する。

## 停止時の扱い

古いbase/head、再実行、CI/レビュー失敗、24時間を超えた証跡、許可範囲外の変更、定義改変、公開なし試験、担当変更はマージしない。自動再試行や古い候補の強制マージは行わない。baseの更新や修正が必要な場合は、担当ルールを維持した修正PR/新しいheadのCI・レビューで確認する。

マージAPIの応答が不明なら結果を調査し、同じPUTを再送しない。マージ後の検証に失敗した場合は実SHAを結果に残す。公開/回帰の失敗も修正PRで対応し、巻き戻し・自動再公開は行わない。

## 通し試験

この構成のCI合格・develop取り込みと専用フラグの登録後、新しい小さな文書Issueを `実装:自動` で起票する。手元では実装せず、AppによるPR作成、独立レビュー、develop自動マージとIssue完了、実マージSHAのCI・公開前照合を確認する。設定PRに対する古い承認待ちが残っている場合は、その実行を公開せず終了させ、最終的な自動マージSHAのstaging承認だけを行う。

本番リリースはこの経路に接続しない。mainへの反映・本番公開には別途人の明示的な判断が必要。X告知は手動で投稿する文面を提示する方針を維持する。
