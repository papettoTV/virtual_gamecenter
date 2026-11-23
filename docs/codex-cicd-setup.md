# Codex・GitHub CI/CD の設定

更新日：2026-11-24。[不要経路の整理記録](cicd-cleanup.md)と[本番リリースの運用](production-one-approval-cd.md)も参照する。

## 現行の実行経路

`実装:自動` のラベル付与 → Codex実装 → AppによるPR作成 → 必須CIと独立Codexレビュー → 同じ候補と固定定義を再照合 → developへ自動マージ → 実マージSHAの初回push CI → ci-controlから公開処理を自動起動 → 検証Worker公開1回・HTTP/ブラウザ回帰1回。共有Pagesの更新が必要な候補は、stagingで人が1回承認してから公開する。

ラベルなしのIssueはチャットから手元実装する。担当ラベルを併用せず、同じIssueでPRを重複作成しない。失敗時は停止し、修正PRで対応する。古いhead/base・証跡の再実行・候補差替えを強制的に通さない。新しいdevelopが出ると、公開前の古いstaging承認待ちは[自動整理](staging-workflow-cancellation.md)する。公開中や確認できない実行は変更しない。

[自動マージの信頼条件と運用](develop-auto-merge.md)、[固定された検証公開処理](staging-live-release.md)、[運用確認手順](staging-operation-check.md)を参照する。

## Repository variables

| 名前 | 通常値 | 用途 |
| --- | --- | --- |
| PULBASE_APP_ID | 5403155 | IssueのPR作成に使う開発用App |
| PULBASE_AUTOMATION_BOT | pulbase-codex[bot] | 自動PRの作者識別 |
| PULBASE_CODEX_ENABLED | true | 自動実装・レビューの受付 |
| PULBASE_DEVELOP_AUTO_MERGE_ENABLED | true | 現行のdevelop自動マージ |
| PULBASE_CONTROL_EVIDENCE_ENABLED | true | 実マージCIからの検証公開起動 |
| PULBASE_CONTROL_EVIDENCE_SHA | 人が配置・確認した40桁のci-control SHA | 人が確認した固定制御SHA。通常のアプリ変更では更新しない |
| PULBASE_STAGING_WORKER_AUTO | true | 検証Workerだけの更新は人の承認なしで実行 |
| PULBASE_PRODUCTION_ENABLED | true | 本番候補の受付。実公開にはproductionでの人の承認が必要 |
| PULBASE_PRODUCTION_CD_REHEARSAL | false | 鍵なし予行時に限り、本番受付をfalseにしてこの変数をtrueにする |

旧 `PULBASE_STAGING_DEPLOY_ENABLED` / `PULBASE_AUTO_MERGE_ENABLED` / `PULBASE_X_ENABLED` は実行経路から参照されないため削除してよい。現行の `PULBASE_DEVELOP_AUTO_MERGE_ENABLED` と取り違えない。変数の停止だけでは実行中の処理が終了したことにはならず、必要な場合は人がActions画面で状態を確認する。

## Environments・鍵・保護

- codex：OPENAI_API_KEY。自動実装と独立レビューに使用。
- automation：PULBASE_APP_PRIVATE_KEY。開発用Appだけを対象リポジトリに限定して使用。
- staging：CLOUDFLARE_API_TOKEN、PULBASE_CHECK_USERNAME、PULBASE_CHECK_PASSWORD。共有Pagesを含む検証公開で使用。
- staging-worker：CLOUDFLARE_WORKER_API_TOKEN、PULBASE_CHECK_USERNAME、PULBASE_CHECK_PASSWORD。検証Workerだけを更新する経路で使用。
- production：PULBASE_RELEASE_APP_PRIVATE_KEY、CLOUDFLARE_WORKER_API_TOKEN、CLOUDFLARE_PAGES_API_TOKEN。本番承認後に使用。
- production-rehearsal：鍵なし予行の承認ゲート。Secretなし。

公開・予行に使う4環境はBranch型ci-controlだけを許可し、管理者bypassを禁止する。staging、production、production-rehearsalには人の承認を設定する。ci-controlのbypassは空に保ち、main更新ルールの例外は本番専用GitHub Appに限定する。stagingとstaging-workerの保護設定版はprotectionMode=strictを保持する。Secret値はチャットやGitへ記載しない。

developはPRとGitHub Actions発行のverify / Automation control checksを必須とし、strict・管理者への適用を維持する。公開コード・レビュー信頼定義はci-controlの固定版を使い、PRのコードや自己申告で置き換えない。保護された定義を更新する場合は、通常のアプリPRとは別の管理手順を準備する。

## 通し試験の実績

[Issue #61](https://github.com/papettoTV/virtual_gamecenter/issues/61) → [PR #62](https://github.com/papettoTV/virtual_gamecenter/pull/62) → 独立レビュー → Appによるdevelopマージ・Issue完了 → 実SHA `4368ea572d4ccf5291e68481ad6e8cf79e65c30f` のCI・公開が成功した。[公開実行40494784321](https://github.com/papettoTV/virtual_gamecenter/actions/runs/40494784321)は承認/公開/回帰各1回、HTTP両SHA一致・ブラウザ8件合格、strict・bypassゼロで完了した。mainは `73cb5d9267c56f06f9f1150327ec6b8b3caa2bb9` のまま。

## ローカル検証

Node 22で `npm ci --ignore-scripts --prefix ci`、`npm test --prefix ci`、`npm run check --prefix ci` を行う。アプリのテスト・ビルドは通常のWeb checksに従う。削除した初回試験や旧配置ツールを再利用しない。

## 本番公開と告知

通常運用では、検証済みの候補が自動でproductionの承認待ちになる。承認後は[本番リリースの運用](production-one-approval-cd.md)に沿って反映し、回帰合格後にmainを昇格する。Xへの告知は、成功時に提示する日本語文面を確認して手動投稿する。
