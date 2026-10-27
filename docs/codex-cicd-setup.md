# Codex・GitHub CI/CD の設定

更新日：2026-10-28。develop向けの通常運用だけを有効化する。main反映・本番公開・X投稿は行わない。初期構築時の古い公開手順・初回認証試験・旧フラグの一括有効化手順は整理した。過去の実装と検証経緯はGit履歴とActions履歴で参照できる。

[削除対象と保持理由の監査記録](cicd-cleanup.md)を参照する。本番準備文書に残る旧stagingフラグ等への言及は当時の記録であり、現行の設定は本書を優先する。

## 現行の実行経路

`実装:自動` のラベル付与 → Codex実装 → AppによるPR作成 → 必須CIと独立Codexレビュー → 同じ候補と固定定義を再照合 → developへ自動マージ → 実マージSHAの初回push CI → ci-controlから公開処理を自動起動 → 人のstaging承認1回 → Worker/Pages公開1回・HTTP/ブラウザ回帰1回。

ラベルなしのIssueはチャットから手元実装する。担当ラベルを併用せず、同じIssueでPRを重複作成しない。失敗時は停止し、修正PRで対応する。古いhead/base・証跡の再実行・候補差替えを強制的に通さない。進行中の古い公開待ちがあれば、公開せず終了させて最新の対象を確認する。

[自動マージの信頼条件と運用](develop-auto-merge.md)、[固定された検証公開処理](staging-live-release.md)、[運用確認手順](staging-operation-check.md)を参照する。

## Repository variables

| 名前 | 通常値 | 用途 |
| --- | --- | --- |
| PULBASE_APP_ID | 5403155 | IssueのPR作成に使う開発用App |
| PULBASE_AUTOMATION_BOT | pulbase-codex[bot] | 自動PRの作者識別 |
| PULBASE_CODEX_ENABLED | true | 自動実装・レビューの受付 |
| PULBASE_DEVELOP_AUTO_MERGE_ENABLED | true | 現行のdevelop自動マージ |
| PULBASE_CONTROL_EVIDENCE_ENABLED | true | 実マージCIからの検証公開起動 |
| PULBASE_CONTROL_EVIDENCE_SHA | 2c883a1cdd961510a0557742f74294739752f445 | 人が確認した固定制御SHA |
| PULBASE_PRODUCTION_ENABLED | false | 未接続の本番経路の無効化。保持する |
| PULBASE_RELEASE_APP_ID | 5405029 | 未接続の本番用App。保持する |

旧 `PULBASE_STAGING_DEPLOY_ENABLED` / `PULBASE_AUTO_MERGE_ENABLED` / `PULBASE_X_ENABLED` は実行経路から参照されないため削除してよい。現行の `PULBASE_DEVELOP_AUTO_MERGE_ENABLED` と取り違えない。変数の停止だけでは実行中の処理が終了したことにはならず、必要な場合は人がActions画面で状態を確認する。

## Environments・鍵・保護

- codex：OPENAI_API_KEY。自動実装と独立レビューに使用。
- automation：PULBASE_APP_PRIVATE_KEY。開発用Appだけを対象リポジトリに限定して使用。
- staging：CLOUDFLARE_API_TOKEN、PULBASE_CHECK_USERNAME、PULBASE_CHECK_PASSWORD。公開ジョブでだけ使用。
- production / release-preflight / announcement：本番準備に関係するため今回の整理では変更・削除しない。詳細は[本番準備](production-cicd-preparation.md)を参照。

stagingはBranch型ci-controlだけ、papettoTV承認必須、管理者bypass禁止。ci-control/mainのbypassは空、stagingのPULBASE_CONTROL_RULE_VERSIONSは人が確認した更新日時とprotectionMode=strictを保持する。Secret値はチャットやGitへ記載しない。

developはPRとGitHub Actions発行のverify / Automation control checksを必須とし、strict・管理者への適用を維持する。公開コード・レビュー信頼定義はci-controlの固定版を使い、PRのコードや自己申告で置き換えない。保護された定義を更新する場合は、通常のアプリPRとは別の管理手順を準備する。

## 通し試験の実績

[Issue #61](https://github.com/papettoTV/virtual_gamecenter/issues/61) → [PR #62](https://github.com/papettoTV/virtual_gamecenter/pull/62) → 独立レビュー → Appによるdevelopマージ・Issue完了 → 実SHA `4368ea572d4ccf5291e68481ad6e8cf79e65c30f` のCI・公開が成功した。[公開実行40494784321](https://github.com/papettoTV/virtual_gamecenter/actions/runs/40494784321)は承認/公開/回帰各1回、HTTP両SHA一致・ブラウザ8件合格、strict・bypassゼロで完了した。mainは `73cb5d9267c56f06f9f1150327ec6b8b3caa2bb9` のまま。

## ローカル検証

Node 22で `npm ci --ignore-scripts --prefix ci`、`npm test --prefix ci`、`npm run check --prefix ci` を行う。アプリのテスト・ビルドは通常のWeb checksに従う。削除した初回試験や旧配置ツールを再利用しない。

## 将来の本番リリース・X設定（既存案を保持、今は有効化しない）

1. 公開チェックリストと環境分離・本番リソース・Secret・復旧手順を確認する。
2. productionの人の承認、main保護とリリース用App、Pages/Workersの自動公開停止を確認する。利用するAction/CLIのバージョンもレビューし、必要に応じてコミットSHAへ固定する。
3. 別途許可を受けて `.github/workflow-templates/production-release.yml.disabled` を `.github/workflows/production-release.yml` に配置し、デフォルトのdevelopで登録したうえでmainにも反映する。実行時の対象refはmainに限定する。
4. `PULBASE_PRODUCTION_ENABLED=true` にする。mainから手動実行し、stagingで確認済みのdevelopの40桁SHAと、人が確認したX告知文を指定する。告知文は今回の実装では保守的に140 Unicode文字まで。
5. prepareでローカルテスト・本番設定ビルド・stagingのSHA照合を行う。人が同じSHAと告知文・既存公開判定の残課題を確認し、productionを承認する。
6. 承認後にmainを指定SHAへfast-forwardする。mainがdevelop候補の祖先でない場合は停止し、履歴を人が整理する。勝手なマージ・force pushはしない。
7. 本番Worker/Pagesを公開し、HTTP・リビジョン・ブラウザ回帰確認が成功した場合だけ手動投稿用の文面を提示する。

本番公開/回帰確認に失敗した場合はX告知を実施せず、Actionsの失敗通知と証跡を確認する。main更新後・Worker公開後・Pages公開後の部分失敗があり得るため、mainが進んだことだけで公開完了としない。自動DBロールバックは行わない。既知の正常Worker/Pagesへ戻す操作とデータ整合確認は運営者が判断する。コードのロールバックだけでDB/DOデータが元へ戻るとは扱わない。

### Xは手動投稿（2026-10-21の方針変更）

Xへの自動送信を廃止し、本番公開・回帰確認が成功した後に日本語のリリース文面だけを提示する。X App・API Key・Access Token・投稿用Secret・`automation-state` ブランチは不要。`PULBASE_X_ENABLED` は文面提示の条件に使っておらず、旧フラグは削除してよい。

リリース準備時にCodexが対象変更から利用者向けの日本語告知案を用意し、人が内容を確認する。workflowの `announcement` 入力へその告知案を渡す。現在の保守的な上限は140 Unicode文字。公開前の承認サマリーには「未投稿の案」として示し、本番公開後の回帰確認に失敗した場合は手動投稿用の成功成果物を作らない。

回帰確認成功後、Actionsの `announce` ジョブのサマリーにコピー用の文面・リリースSHA・未投稿である旨を表示する。同じ文面を `manual-release-announcement-<SHA>` artifactの `release-announcement.txt` と `release-announcement.md` に14日保存する。運営者が確認してXへ手動投稿する。手動で投稿したかどうかをCIは取得・記録しないので、投稿前にX上で確認する。

文面提示ジョブはEnvironment・GitHub App token・X資格情報を使用せず、Xへの送信やGitHubの投稿状態書込を行わない。文面生成に失敗した場合は入力を確認し、そのジョブだけを再実行する。本番公開全体を文面生成のために再実行しない。

告知先を追加する場合も、まず配布用文面として準備する。自動投稿への再変更は別途指示を受ける。ユーザー向けGitHub Releasesやサイト内告知は今回作成しない。
