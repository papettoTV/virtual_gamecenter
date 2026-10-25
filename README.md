# 鍵なしの公開制御workflow：配置前レビュー

2026-10-23。これは公開なしの予行試験用であり、本番・検証公開を有効にするパッケージではない。

## 実装した範囲

- 保護されたci-controlの実行SHAだけをcheckoutし、制御コードはそこから実行する。ActionはGitHub公式リポジトリで照合した完全SHAへ固定した。
- 事前ジョブは、stagingの承認者・管理者bypass禁止・Branch型ci-control限定・制御/mainルールの公開情報とSHAをGitHub GETで確認する。読取APIがbypass一覧を省略する場合があり、省略を空とは扱わない。承認後に、人が詳細を確認した設定版と照合する。
- stagingの承認を要求するジョブは1つだけで、その中で「候補公開・回帰・マージ・実SHAのCI・再公開・再確認」の状態遷移を模擬実行する。承認後も設定を再読取し、同じrun/control SHAの事前確認だけを採用する。
- 模擬結果にはmode=rehearsal-only、simulated=true、realMergeExecuted=false、realDeploymentExecuted=falseを明記する。合成PR番号・SHAを実公開の成功証跡として出さない。
- Cloudflare・OpenAI・App秘密鍵を参照しない。利用する認証はGitHubがジョブへ発行する一時読取GITHUB_TOKENだけで、権限はContents/Actions read。長期鍵の登録は不要である。
- GitHub書込・実マージ・Cloudflare操作・候補コードの実行・npm install・self-hosted runner・候補由来のキャッシュは含まない。

## 実装していない範囲

実PR/レビュー/CI成果物の照合、実公開用のadapters、実マージ、ブラウザ回帰、自動dispatchの開発側接続は未接続である。模擬試験の成功をIssueからの通し試験や実公開の成功と扱わない。本番処理は含まない。

## ファイル

- .github/workflows/staging-control-rehearsal.yml：GitHubへ配置するworkflow。開発用原本ではworkflow-templates内の.disabledとして保管し、まだ有効化しない。
- ci/control/protection-check.mjs：固定されたGitHub GETだけを使う保護確認。
- ci/control/single-approval.mjs：特定のPR/候補/実行に限定された承認スコープと状態遷移。
- ci/control/rehearsal.mjs：実APIを使わない明示的な模擬処理。
- ci/tests/single-approval.test.mjs、ci/tests/control-protection.test.mjs：外部依存なしの20試験。

Node.js 22で `node --test ci/tests/*.test.mjs` を実行すれば、GitHub認証も外部接続も不要で停止条件を検証できる。

## 初期配置の方針（まだ実行しない）

ci-controlは作成自体も保護されている。管理者やpapettoTVをbypassに追加すると開発PATも同じ本人として通過できるため採用しない。ルール全体の無効化も行わない。

代わりに、既に鍵を人の管理下へ分離したpulbase-release（App ID 5405029）だけを、ci-controlルールの初期配置用bypassへ一時追加する案とする。まずそのAppの権限と新鍵の保管状態を確認し、初期配置スクリプトをレビューしてから個別に案内する。main側のbypassは空のままで、AppにAdministration/Environments/Secrets/DeploymentsのWriteを与えない。既存のAI用App/PATはci-controlへ引き続き書けない。

人は管理用の別端末・別OSユーザーで、レビュー済みパッケージだけを配置する。App秘密鍵をCodex・チャット・Git・パッケージ・Actionsへ新規登録しない。一時的なAppトークンは対象リポジトリと必要最小限に絞り、配置後に失効させる。配置したcommit/treeとファイルの一致を確認してからbypassを空へ戻す。bypassが空へ戻ったことをAPIで確認するまで予行workflowを実行しない。

これは後続の配置手順の案であり、一時例外の追加・Appの増権・ブランチ作成を今行う指示ではない。人が管理するAppのWorkflows権限が未確認であるため、この段階で適用済みとは扱わない。

## 人が確認した設定版の固定

GitHub APIは呼出元によってbypass_actorsを省略する。確認のためにActionsへAdministration writeを付けたり、管理用PATを渡したりしない。代わりに、人が例外一覧を確認したルールのupdated_atを、stagingのEnvironment variable `PULBASE_CONTROL_RULE_VERSIONS` にJSONで固定する。

値は `{"ciControl":"ルール25676153のupdated_at","main":"ルール25520943のupdated_at"}` の形式で、秘密情報ではない。初期配置後にApp例外を空へ戻し、APIで詳細一覧を照合してから正確な値を案内する。今は登録しない。

承認前の公開情報確認だけではprotectionVerified=trueとしない。承認後のジョブは必ず固定値と公開APIの更新版を照合し、変数未登録・不一致・例外が見えていて空でない場合は停止する。管理者がルールを変更した後は、詳細一覧を確認してこの非秘密変数も更新しないと実行できない。GitHubが更新時刻を返さない場合も停止する。

この変数を変更できるEnvironment管理権限はAI用PAT/Appへ与えない。初期配置ツールも人が詳細を確認した更新版を固定し、例外追加後の版を独立確認するまでapplyを無効にする。配置後のApp例外削除によって版が変わるので、その後の最終値を使う。

## GitHub上での予行試験

workflow_dispatchの登録には既定ブランチにも同じworkflowファイルが必要になる。develop側には鍵なしの登録用定義だけを別途準備し、通常CIを通して反映する。実行時にはci-controlを選ぶ。developやTagからの起動は事前チェックで失敗し、staging承認へ進まない。

ci-control配置とロック、登録用定義の準備後、公開なしの実行URLを示してstaging承認を1回だけ案内する。VS Codeの認可変更や無関係なサービスの監査は先行条件にしない。

## 後続の実公開版

予行試験で保護境界を確認した後、同じ単一承認ジョブに実PRの独立検証と固定公開adaptersを接続する。開発側の自動起動は鍵なしで固定workflowをci-control指定でdispatchし、排他は制御側だけで保持する。旧経路の二重公開・二度目の承認を切替時に止める。鍵登録・検証公開の試験は対象SHAと固定コードを明示した別の段階で、人へ順番に案内する。main反映・本番公開・X投稿は今回行わない。
