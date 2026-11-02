# CI/CDの不要経路整理（2026-10-28）

## 対象と結果

現行経路は、実装:自動のラベル付与 → PR → 必須CI・独立Codexレビュー → develop自動マージ → 実SHAのCI → ci-control → staging承認1回 → 公開/回帰各1回。Issue #61 / PR #62 / 実SHA4368ea5 / 公開実行40494784321で成功している。

参照元を調べ、以下を削除した。過去のソースと実行証跡はGit/Actions履歴に残る。

- 旧候補検証の停止専用workflow 2件。現行のpremerge照合ライブラリは共有されるので保持。
- 初回だけのCodex API試験と開発用App認証試験、それぞれの専用テスト。実際の自動実装・PR作成・レビュー・マージで認証を確認済み。
- developを条件にする旧service-check workflowと旧staging-preflight、専用テスト。現行stagingはci-controlだけを許可するため、この経路は実行できない。専用監視Workerと手元の読取チェックは保持。
- 現行workflowから参照されない旧deploy-staging-artifactと専用の公開テスト。CI成果物の生成・検証と、そのテストは保持。
- 有効化済みdispatcherと同じ内容を持つdisabledコピー。検査は稼働中の定義を直接確認する。
- 古い親SHA/設定版に固定された一度きりの配置・ZIP作成ツールと専用テスト。現在のci-controlの更新にはそのまま使えない。再利用できる信頼定義の準備ツール、読取診断、偽APIでの公開メタデータ検証は保持。
- 公開前の予行試験手順2件と、通し試験用だけの文書2件。現行運用・成功実績は設定文書へ集約し、旧フラグを再有効化する初期手順を通常運用案内から取り除いた。

## 削除せず保持するもの

- `.github/workflows/postmerge-staging.yml`：default branchに必要なworkflow_dispatchの登録用定義。実処理はci-controlの固定版で行うため、この登録を消さない。
- `.github/workflows/develop-staging.yml`：鍵も公開権限もない停止専用定義。固定信頼定義25ファイルの一つであるcheck-workflowsが存在を検査するため保持。これも削除する場合は、人が確認する信頼定義・制御版の更新を別途行う。
- ci/control、実公開の原本テンプレート、固定された信頼定義25ファイル：テスト対象/実行元として必要。今回の整理でci-control・固定制御SHA・strict・bypassは変更しない。
- 本番テンプレート、deploy-built、check-pages/check-revision、ci/browserとPlaywright設定、release-announcement、本番のアプリ設定・リソース・準備文書：未接続の本番経路としてすべて保持。有効化やmain反映は行わない。

## GitHub設定の整理

Repository variablesで不要なのは次の3件だけ。コードから値を読む参照はない。

- `PULBASE_STAGING_DEPLOY_ENABLED`（旧直接公開）
- `PULBASE_AUTO_MERGE_ENABLED`（旧マージ）
- `PULBASE_X_ENABLED`（旧自動投稿。現在は文面提示だけ）

コード削除とGitHub上の変数削除は別作業。未削除でも現行経路には使われない。管理用端末でこの3件だけ削除できる。現行のPULBASE_DEVELOP_AUTO_MERGE_ENABLEDを削除しない。productionの無効フラグとrelease App IDも保持する。

監査時、RepositoryのActions Secretは0件、automationはApp鍵1件、codexはOpenAIキー1件、stagingはCloudflareとBasicの3件だった。これらは現行経路で使用するため削除しない。production / release-preflight / announcementは本番準備に関係するため変更しない。Secret値は取得していない。

## 検証

残るNodeテスト112件・workflow/template10件を確認。削除したコードだけを対象にしたテストを整理したため件数は減ったが、現行の証跡・マージ・公開・回帰・本番告知のテストは保持する。固定manifestのGit blob一致検査、本番テンプレートと依存ソースの差分なし、残る実行コードのローカルimport先の存在を確認する。実公開は人のstaging承認前には行わない。
