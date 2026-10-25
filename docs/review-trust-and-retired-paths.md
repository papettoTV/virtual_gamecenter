# レビュー証跡の信頼条件と旧公開経路の停止

## 旧経路の停止

Codex PR verificationは受付・同一候補CI・独立レビュー・証跡保存までとする。staging公開・回帰・merge・旧reportジョブを削除し、公開用の共通ロックも保持しない。develop-stagingは自動イベント・Environment・Secretのない停止専用定義とする。旧mergePrと旧develop公開CLIも常に停止する。旧有効フラグがtrueでもこれらの経路から公開・マージはできない。

取り込み後、人がRepository variablesのPULBASE_STAGING_DEPLOY_ENABLEDとPULBASE_AUTO_MERGE_ENABLEDをfalseへ変更して残設定を整理する。新経路のPULBASE_CONTROL_EVIDENCE_ENABLEDとは別物であり、後者と固定制御SHAを維持する。

## 固定する信頼条件

- レビューworkflowの全Actionを実コミットへ固定する。Codex Actionは既存のAPI試験と同じbdf19a4、CLIは成功済みレビューと同じ0.164.0。
- source runが同一repoのpull_request、初回attempt、成功済み、同じPR番号/head/baseのsnapshotを持つことをGitHub APIで確認する。snapshotが欠落しても自己申告で代用しない。
- 24時間以内の証跡のみを扱い、既存の最新run照合・候補再照合・成果物ハッシュ検査も併用する。
- review-trust.jsonが固定するレビュー/CI定義、prompt/schema、ポリシー、証跡生成コード、依存lock、ビルド設定等25ファイルを、base/head/merge候補すべてのGit treeで照合する。欠落、変更、リンク、不完全なtree、新しいagent設定は停止する。
- manifestは人がレビューした版をci-controlへ配置して初めて公開判断の信頼基準になる。develop上で自動再生成した版やPR/成果物内の自己申告を採用しない。定義を変更する場合は人による再確認・保護ブランチ更新が必要。

## 現在の範囲

この変更で旧経路を停止し、固定されたレビュー生成元と信頼検証コードを準備する。保護されたci-controlは現在90cfba2の公開なし試験版のままであり、新しい信頼条件の実行時への接続は、次の人による配置後となる。鍵登録・実公開・実マージはまだ行わない。

モデルのレビュー合格は、コードに欠陥がない保証ではない。固定するのは判定の生成元と対象の同一性であり、人の公開承認、決定的なCI、回帰確認を置き換えない。
