# レビュー証跡の信頼条件と旧公開経路の停止

## 旧経路の停止

Codex PR verificationは受付・同一候補CI・独立レビュー・証跡保存までとする。staging公開・回帰・merge・旧reportジョブを削除し、公開用の共通ロックも保持しない。develop-stagingは自動イベント・Environment・Secretのない停止専用定義とする。旧mergePrは停止関数のまま保持し、旧develop公開CLIは削除した。旧有効フラグがtrueでもこれらの経路から公開・マージはできない。

2026-10-28の整理で不要な旧起動workflow・旧公開CLIを削除した。Repository variablesのPULBASE_STAGING_DEPLOY_ENABLEDとPULBASE_AUTO_MERGE_ENABLEDは参照がなく削除してよい。新経路のPULBASE_CONTROL_EVIDENCE_ENABLEDとは別物であり、後者と固定制御SHAを維持する。

## 固定する信頼条件

- レビューworkflowの全Actionを実コミットへ固定する。Codex Actionは既存のAPI試験と同じbdf19a4、CLIは成功済みレビューと同じ0.164.0。
- source runが同一repoのpull_request、初回attempt、成功済み、同じPR番号/head/baseのsnapshotを持つことをGitHub APIで確認する。snapshotが欠落しても自己申告で代用しない。
- 24時間以内の証跡のみを扱い、既存の最新run照合・候補再照合・成果物ハッシュ検査も併用する。
- review-trust.jsonが固定するレビュー/CI定義、prompt/schema、ポリシー、証跡生成コード、依存lock、ビルド設定等25ファイルを、base/head/merge候補すべてのGit treeで照合する。欠落、変更、リンク、不完全なtree、新しいagent設定は停止する。
- manifestは人がレビューした版をci-controlへ配置して初めて公開判断の信頼基準になる。develop上で自動再生成した版やPR/成果物内の自己申告を採用しない。定義を変更する場合は人による再確認・保護ブランチ更新が必要。

## 現在の範囲

通常運用は固定制御SHA `2c883a1cdd961510a0557742f74294739752f445` を使い、自動Issueからdevelopマージ、staging承認1回後の公開/回帰まで実証済み。strict・bypassゼロを維持する。レビューと実マージの運用は[自動マージ](develop-auto-merge.md)、公開は[CI/CD設定](codex-cicd-setup.md)を参照する。

停止用develop-staging定義は固定信頼定義のcheck-workflowsが検査するため残す。default branchのpostmerge-staging定義もGitHubのdispatch登録に必要。どちらも直接公開のための鍵・Environment・権限を持たない。稼働経路に影響する固定25ファイルは今回変更しない。本番テンプレートとその依存コードも保持し、まだ有効化しない。
