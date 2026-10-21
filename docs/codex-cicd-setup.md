# Codex・GitHub CI/CD の準備と設定

更新日：2026-10-21。CI/CD本体をリモートdevelopへ選択的に統合し、Web checks成功とdevelopの保護設定を確認済み。GitHub Appの認証試験と、人が承認したOpenAI API固定応答試験が成功した。GitHubのデフォルトブランチはdevelop。mainへの反映、Cloudflareの設定変更・デプロイ、X投稿は行っていない。自動実装・自動マージ・検証公開のフラグはfalseのまま。

## 構成と実装範囲

| ファイル | 用途 |
| --- | --- |
| `.github/workflows/codex-issue.yml` | 運営者のIssue起票、または運営者による `codex:run` ラベル付与 → Codex実装 → テキスト差分検査 → develop向けPR作成 |
| `.github/workflows/codex-pr.yml` | 自動PRの対象/差分確認 → 合成マージコミットのテスト → 独立したCodexレビュー → staging公開 → HTTP/ブラウザ確認 → developへのマージ・Issue完了 |
| `.github/workflows/develop-staging.yml` | develop push後のテスト・検証公開・ブラウザ確認。マージ後の実コミットSHAを検証URLへ反映 |
| `.github/workflows/web-checks.yml` | 従来のテスト/ビルドに自動化制御部分のテストを追加 |
| `.github/workflow-templates/production-release.yml.disabled` | **実行されない本番用テンプレート**。人の承認 → mainへfast-forward → 本番公開 → 回帰確認 → X告知 |
| `ci/` | 入力・差分・レビュー・公開先・リビジョンの検査、ブラウザテスト、X投稿と永続状態管理 |

すべての有効化フラグは未設定をfalseとして扱う。現在はIssue起票やdevelop pushによって新しい自動実装・公開は開始しない。既存の `Web checks` と手動サービス確認は維持する。

Codexは実装とレビューを別ジョブ・別ランナーで行う。実装ジョブにGitHub書込資格情報・Cloudflare・XのSecretを渡さない。Codexをジョブ最後のステップに置き、後続のGitHub書込は新しいランナーで行う。候補のテスト/ビルドのステップにCloudflareトークンを渡さず、検査済み成果物のデプロイ時だけ渡す。

初期の自動化対象はUI・ゲーム・関連テスト・ドキュメント。`ci/policy.mjs` にパス規則がある。認証・同意・残高・決済・Worker・DB移行・依存・設定・ワークフロー等は停止して人へ戻す。保護対象を避ける別実装やテスト削除で通過させない。テキスト差分は90KB、変更は60ファイルまで。実装中の修正は最大2回、実装30分/レビュー15分。CI失敗後に無限にCodexを再起動する機能は入れていない。失敗の証跡を見て修正・再実行する。

ブラウザ確認はChromiumのデスクトップ/モバイル画面で、ホーム・ゲーム一覧・規約・プライバシー・ゲーム画面への遷移・初回特典の辞退・開始前のキャンセル・ホームへの復帰を確認する。Googleの実認証、クレジット消費を伴うプレイ、課金、全ゲームの実機性能を網羅したものではない。変更固有の受け入れ条件はIssueに明記し、対応するテストを実装する。高リスクな変更は通常の人のレビューへ回す。

ブラウザがホームを開くと既存のbootstrap APIによりテスト用ゲストが作成される。開始・クレジット消費・Googleログインは行わない。公開後のブラウザ確認にもこの書込があるため、本番有効化時にテストデータの扱いと既存保持/削除方針を確認する。画面サイズのエミュレーションをiPhone/Android実機検証の完了とは扱わない。

## 1. 今回の準備段階で行うこと

1. この差分をdevelopでレビューする。ローカルdevelopとorigin/developに既存の分岐があるため、履歴を確認して今回のコミットだけを適切に取り込む。全ローカル履歴をそのままpushしない。
2. 下記のGitHub App・Environment・Secretを準備する。値をチャットやIssueに貼り付けない。
3. 自動化フラグはfalseのまま維持する。X/main/本番の設定は本番導入時まで保留できる。
4. ローカルのテスト・静的検証を行う。クラウドでの通し試験は別の導入段階として記録する。

**デフォルトブランチについて：** 2026-10-21、ユーザーの指示でGitHubのデフォルトをmainからdevelopへ変更し、APIで反映を確認した。mainへのコミットやPages Production branchは変更していない。`issues` と `workflow_dispatch` の登録先は今後developとなる。CI/CD本体はリモートdevelopへ反映済み。ただし自動実装/マージ/公開のフラグは無効。元のローカルdevelopとの分岐は保持し、無関係な履歴は取り込んでいない。`--ref develop` だけでは未登録のワークフローを実行できない。設定確認時点でリポジトリの有効化フラグは未登録だった。

## 2. GitHub App

GitHub Settings → Developer settings → GitHub Apps → New GitHub Appで、実装PRを作成するAppを作成する。Webhookはこの構成では不要。対象リポジトリだけにインストールする。

必要なRepository permissions：

- Contents: Read and write（作業ブランチ作成、コミット、push）
- Pull requests: Read and write（PR作成・マージ）
- Issues: Read and write（Issue読取・完了）
- Checks: Read（CI成功確認）
- Administration: Read（developのstrict保護と必須チェックの読取。設定変更権限は付与しない）
- Metadata: Read（自動付与）

App IDと、生成したPrivate keyを後述の変数/Secretに保存する。`PULBASE_AUTOMATION_BOT` は実際のAppユーザー名（例：`pulbase-codex[bot]`）と一致させる。CodexレビューActionの `allow-users` にこのユーザー名を渡す。

Appトークンを使ってPRを作成し、後続のpull_request/pushワークフローを起動する。通常の `GITHUB_TOKEN` への置き換えはしない。Appをmain保護のbypass actorに登録しない。

本番導入時はリリース用Appを別に作成する。Contents: Read and write、Metadata: Read。実装Appと鍵を共有せず、main反映に必要な権限は本番Environmentに限定して保存する。本番Appのmain更新を許可するルールと承認Environmentをセットで整備し、単にmain保護を解除しない。

## 3. GitHub Variables / Environments / Secrets

Repository → Settings → Secrets and variables → Actions → Variablesに設定する。

| Variable | 初期値 | 用途 |
| --- | --- | --- |
| `PULBASE_CODEX_ENABLED` | `false` | Issue実装と自動PR検証 |
| `PULBASE_STAGING_DEPLOY_ENABLED` | `false` | 検証環境の公開 |
| `PULBASE_AUTO_MERGE_ENABLED` | `false` | 検証成功後のdevelopマージ |
| `PULBASE_PRODUCTION_ENABLED` | `false` | 将来の本番テンプレート用 |
| `PULBASE_X_ENABLED` | `false` | 将来のX告知用 |
| `PULBASE_APP_ID` | 作成したApp ID | 実装用App |
| `PULBASE_AUTOMATION_BOT` | 作成したAppのbot名 | 自動PRの本人確認 |
| `PULBASE_RELEASE_APP_ID` | 本番導入時に設定 | リリース用App |

Settings → Environmentsで以下を作成する。

| Environment | Secrets | 設定 |
| --- | --- | --- |
| `codex` | `OPENAI_API_KEY` | 最初は人の承認付きで試し、運営者Issueの自動実行確認後に見直す |
| `automation` | `PULBASE_APP_PRIVATE_KEY` | 実装用App。mainへのbypass不可 |
| `staging` | `CLOUDFLARE_API_TOKEN`, `PULBASE_CHECK_USERNAME`, `PULBASE_CHECK_PASSWORD` | 検証専用の権限/Basic認証。最初は人の承認付きで試す |
| `production` | 本番専用 `CLOUDFLARE_API_TOKEN`, `PULBASE_CHECK_USERNAME`, `PULBASE_CHECK_PASSWORD`, `PULBASE_RELEASE_APP_PRIVATE_KEY` | **将来のみ**。Required reviewersに人を指定。管理者bypassを許可しない |
| `announcement` | `PULBASE_RELEASE_APP_PRIVATE_KEY`, `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | **将来のみ**。X投稿専用。初回は承認付きで確認 |

stagingにはdevelop pushと自動PRの合成マージrefがアクセスする。Environmentのブランチ制限でPRを許可する場合は `refs/pull/*/merge` を対象に含める。productionはmainのみ。announcementもmain実行の本番ワークフローに限定する。

一人でリリース開始/承認する場合、productionのPrevent self-reviewを有効にすると自分の開始した実行を承認できない。運営体制に合わせて設定する。いずれの場合も自動処理が人の代わりに承認しない。

### OpenAI

OpenAI Platformでこの自動化専用のProject/APIキーを発行し、`codex` の `OPENAI_API_KEY` に保存する。API利用は別途利用枠・課金を確認し、予算通知/利用制限を設定する。ChatGPTの契約だけでこのActionのAPI利用がまかなわれるとは扱わない。

モデルはCodex Actionの既定を使用する。モデル固定が必要なら公式の利用可能モデルを確認してActionのmodel/effortを追加する。費用上限はジョブtimeoutだけで保証されないため、API側の管理も必要。

Secret登録はGitHub画面、または値を端末へ露出しない標準入力/保護ファイル経由で行う。CLI例（対話入力する場合）：

```sh
gh secret set OPENAI_API_KEY --env codex
gh secret set PULBASE_APP_PRIVATE_KEY --env automation
gh secret set CLOUDFLARE_API_TOKEN --env staging
gh secret set PULBASE_CHECK_USERNAME --env staging
gh secret set PULBASE_CHECK_PASSWORD --env staging
```

## 4. GitHubの保護設定

developに対するPRを必須とし、少なくとも `Web checks` の `verify` と `Automation control checks` を必須チェックにする。Require branches to be up to date before mergingを有効にする。Appにこの保護のbypassを与えない。初期実装はclassic branch protectionのstrict/必須チェックをAPIで検査し、不足していれば停止する。rulesetsだけで運用する場合は、同等の検査を実装するまでは自動マージを有効にしない。自動PRは追加でCandidate tests・Codexレビュー・staging確認をすべて通らないとマージ処理へ進まない。

mainの保護は維持する。実装用Appによるmain更新を許可しない。mainの本番リリース方式・リリース用Appへの限定許可は、別途本番導入時にレビューする。

マージはmerge commitを使用するため、Allow merge commitsが必要。対象PRに対する最新Web checksが成功していない、base/headが変わった、合成マージコミットの親が不一致の場合は停止する。baseの同時更新はGitHub側のstrict保護でも拒否させる。マージ後のtreeも検証したtreeと照合する。

## 5. Cloudflare（検証有効化時）

既存の `wrangler` スキルと環境別設定を使用する。対応先は変更しない。

- 検証：develop / `develop.virtual-gamecenter.pages.dev` / `pulbase-staging`
- 本番：main / `pulbase.com`・`virtual-gamecenter.pages.dev` / `pulbase-production`

Cloudflare API Tokenは対象アカウントに限定する。既存Worker/Pagesを更新できるWorkers Scripts Edit、Cloudflare Pages Editを基本とし、利用中のバインディングに必要な権限を公式のWrangler権限表で確認する。Workersの配置/DO/既存Analytics Engine/Rate Limitingなどは構成に応じて追加が必要。Global API Keyは使わない。D1移行、リソース作成、Secret登録は自動化しないため、そのためだけの権限を追加しない。

PagesのGit連携の **Preview自動デプロイを停止** してから検証用フラグを有効にする。そうしないとCI外のビルドが今回の公開を上書きする。Production branchはmainのまま維持し、今回本番の設定を変更しない。新パイプラインはPages APIを読み、preview自動公開が有効ならWorker公開前に停止する。本番導入時はProduction自動デプロイも止める必要があり、本番テンプレートはmain更新前に確認する。

Workers Builds等の別の自動デプロイ経路もある場合は対象環境の重複実行を止める。今回これらのクラウド設定は変更していない。

PagesとWorkerは同一SHAでビルドして公開する。HTTP応答の `X-Pulbase-Revision`（Worker）と `X-Pulbase-Gateway-Revision`（Pages）を照合し、古い配信内容を合格にしない。WebSocketの101応答は変換しない。

DB移行が必要な変更は停止して人が扱う。既存の公開チェックリストの未完了事項は維持し、自動テスト成功で本番公開条件を満たしたとは扱わない。

## 6. 有効化と通し試験の順序

準備コミットのリモートdevelopへの統合、ワークフロー登録、全フラグfalseでのWeb checks、GitHub App認証、OpenAI固定応答試験、develop保護は完了。以下の自動実装から検証公開までの通し試験は未実施。

1. 全フラグfalseでWeb checksを通す。API/Secretが無い状態でも既存のCIが動くことを確認する。
2. `PULBASE_CODEX_ENABLED=true` のみ有効化し、小さなUI変更と明確な受け入れ条件のIssueを運営者が起票する。PRがdevelop向けであることと、レビュー/テストの証跡を確認する。
3. パス保護対象・テスト失敗・第三者の未承認Issue・レビュー不合格で停止することを確認する。既存PRがあるIssueの再実行では重複PRを作らない。
4. Cloudflare Preview自動公開停止と検証トークンを確認し、`PULBASE_STAGING_DEPLOY_ENABLED=true` にする。PRワークフローを再実行する。Worker/PagesのSHA、HTTP結果、デスクトップ/モバイル画像を確認する。
5. developのstrict保護を確認後、`PULBASE_AUTO_MERGE_ENABLED=true` にする。PRワークフローを再実行し、developだけへのマージ、Issue完了、develop pushによるstaging更新を確認する。
6. 本番/Xのフラグとテンプレートは引き続き無効にしておく。

初期はIssueを1件ずつ処理する。検証URLを共有するため、PR検証とdevelop公開は同じconcurrencyグループで直列化する。GitHub concurrencyは一般的なFIFOキューではなく、複数の待機実行があると古い待機が置き換えられる場合がある。キャンセル/古いbaseで止まったPRは最新developに更新して再実行する。大量同時受付の保証が必要になった段階で永続キュー/merge queueとPR専用環境へ拡張する。

証跡はPRコメントからActionsへリンクし、HTTP JSON・PlaywrightのHTMLレポート・スクリーンショットを14日保持する。認証情報を含み得るtrace/storageState/videoは保存しない。APIキー・実利用者のデータをIssueや画像に含めない。

## 7. 将来の本番リリース・X設定（今は有効化しない）

1. 公開チェックリストと環境分離・本番リソース・Secret・復旧手順を確認する。
2. productionの人の承認、main保護とリリース用App、Pages/Workersの自動公開停止を確認する。利用するAction/CLIのバージョンもレビューし、必要に応じてコミットSHAへ固定する。
3. 別途許可を受けて `.github/workflow-templates/production-release.yml.disabled` を `.github/workflows/production-release.yml` に配置し、デフォルトのdevelopで登録したうえでmainにも反映する。実行時の対象refはmainに限定する。
4. `PULBASE_PRODUCTION_ENABLED=true` にする。mainから手動実行し、stagingで確認済みのdevelopの40桁SHAと、人が確認したX告知文を指定する。告知文は今回の実装では保守的に140 Unicode文字まで。
5. prepareでローカルテスト・本番設定ビルド・stagingのSHA照合を行う。人が同じSHAと告知文・既存公開判定の残課題を確認し、productionを承認する。
6. 承認後にmainを指定SHAへfast-forwardする。mainがdevelop候補の祖先でない場合は停止し、履歴を人が整理する。勝手なマージ・force pushはしない。
7. 本番Worker/Pagesを公開し、HTTP・リビジョン・ブラウザ回帰確認が成功した場合だけ告知ジョブへ進む。

本番公開/回帰確認に失敗した場合はX告知を実施せず、Actionsの失敗通知と証跡を確認する。main更新後・Worker公開後・Pages公開後の部分失敗があり得るため、mainが進んだことだけで公開完了としない。自動DBロールバックは行わない。既知の正常Worker/Pagesへ戻す操作とデータ整合確認は運営者が判断する。コードのロールバックだけでDB/DOデータが元へ戻るとは扱わない。

### X Developer設定

X Developer Consoleで投稿先の運営アカウント用Appを用意する。OAuth 1.0aのユーザーコンテキスト、Read and Write権限を設定し、そのアカウントのAccess Token/Secretを発行する。権限変更後は必要に応じて再発行する。App-only Bearer Tokenでは代用しない。利用可能な契約・残高・投稿上限はConsoleで確認する。

`announcement` Environmentに次の4値を保存する：`X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`。投稿先が本当に運営アカウントであることを初回有効化前に確認する。

GitHubに状態記録専用の `automation-state` ブランチを人が作成する。本番/検証公開の対象には含めない。リリース用Appだけにこのブランチの更新を許可する。実装は `x-announcements/<release SHA>.json` にpending/sent/uncertainと投稿IDを保存する。公開リポジトリなので、この状態ファイルに秘密情報や非公開情報を入れない。

準備後に `PULBASE_X_ENABLED=true` にする。今回の導入ではまだ設定しない。

投稿前にGitHubへpendingを排他的に予約し、その後 `POST https://api.x.com/2/tweets` を1回だけ実行する。sentの再実行はスキップする。送信結果不明・投稿成功後の記録失敗は自動再送しない。運営者がX上の投稿有無を照合し、投稿済みなら正しいID付きsentへ、未投稿と確認できた場合だけ予約を解除して告知ジョブを再実行する。再実行は失敗した告知ジョブだけを対象にし、本番公開全体を再実行しない。

告知先の追加はこの公開成功後のジョブに追加する。ユーザー向けGitHub Releasesやサイト内告知は今回作成しない。

## 8. ローカル検証

Node 22を使用する。macOSの通常のgitがXcodeライセンスで止まる場合、利用可能なCommand Line Toolsのgitでローカル検証できる。ライセンス同意を自動で代行しない。

```sh
export PATH="/opt/homebrew/opt/node@22/bin:/Library/Developer/CommandLineTools/usr/bin:$PATH"
npm ci --prefix ci
npm test --prefix ci
npm run check --prefix ci
cd apps/web
npm test
PULBASE_RELEASE_SHA="$(git rev-parse HEAD)" npm run build:staging
```

GitHub Actions上のSecret/API/デプロイを使う通し試験、実環境のブラウザ確認、X実投稿は上記のローカル試験に含まれない。

## 公式資料

- [Codex GitHub Action](https://learn.chatgpt.com/docs/github-action)
- [GitHubイベントとデフォルトブランチ](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [GITHUB_TOKENのイベント制約](https://docs.github.com/en/actions/concepts/security/github_token)
- [GitHubのデプロイ承認](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments)
- [Cloudflare Pages自動公開設定](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/edit/)
- [Wranglerの権限](https://developers.cloudflare.com/workers/authorization/workers/)
- [X投稿API](https://docs.x.com/x-api/posts/create-post)
- [既存環境設計](production-environments.md)・[公開条件](production-launch-checklist.md)

## 今回の検証記録

2026-10-21、Node 22のローカル環境で確認。

- アプリの既存全831テスト成功（共有作業フォルダの最終状態でも再確認）。
- 自動化制御の17テスト成功。入力/パス/権限/古いbase/保護設定/CI失敗/公開リビジョン不一致/Xの重複・不明応答・状態保存失敗を含む。差分公開の試験は一時ディレクトリのローカルbareリポジトリだけを使用。
- 型検査、実コミットSHAを埋めたstagingビルド成功。Worker/Pages両方の生成コードにSHAが含まれることを確認。
- actionlint 1.7.12による全ワークフローと無効な本番テンプレートの構文確認成功。CI用YAML/依存関係・権限境界の検査成功。
- Playwrightの8ケースの読み込み確認成功。ブラウザ操作自体・クラウド公開・GitHubイベントによる通し実行・OpenAI API実行・X実投稿は未実施。
- CI専用依存はアプリと別lockfileに固定。追加依存のnpm auditは指摘0件。

本番用ワークフローは引き続き実行対象外。既存の長時間負荷試験・実機・公開判定の未完了事項は変更しない。


## GitHub App・Secretの設定確認（2026-10-21）

- App：`pulbase-codex` / App ID `5403155`。Repository VariablesへApp IDと `pulbase-codex[bot]` を登録。
- `codex` Environment：`OPENAI_API_KEY` の登録名を確認。papettoTVの承認が必要で、自己承認はユーザーの明示許可により有効。
- `automation` Environment：`PULBASE_APP_PRIVATE_KEY` だけが登録されていることを確認。OpenAIキーの重複は既に除去されており、今回削除操作は不要だった。Secret値の読み取りはしていない。
- [GitHub App認証試験 39513777525](https://github.com/papettoTV/virtual_gamecenter/actions/runs/39513777525)：成功。JWTによるApp本人確認、必要なApp権限宣言、対象repoへのインストール、repo限定・読み取り専用インストールトークンの発行/読取を確認し、試験後にトークンを失効させた。PR作成・書込動作自体は未試験。
- 認証試験は `.github/workflows/github-app-auth-check.yml`。固定SHAのgithub-scriptを使用し、checkout・アプリコード実行・OpenAI呼出・公開コマンドは含めない。最初の試験はOctokitの既定認証がカスタムJWTヘッダーを上書きする問題で失敗し、直接HTTP送信へ修正。JWT署名・送信先・読み取り専用scope・失敗時のトークン失効をローカル試験へ追加し、制御系19テストとactionlintが成功した。
- リモートdevelopへの追加/修正コミットは `[skip ci]` を先頭に付け、既存CI/Pagesの自動ビルドをスキップ。認証試験の前後でmainのSHAが同一であることを確認した。
- `PULBASE_CODEX_ENABLED` / `PULBASE_STAGING_DEPLOY_ENABLED` / `PULBASE_AUTO_MERGE_ENABLED` は引き続きfalse。この時点ではOpenAIキーの登録確認のみ。その後の固定応答試験の結果は以下に記録する。


## CI/CD本体のdevelop統合（2026-10-21）

元の作業フォルダとは別の一時チェックアウトで、最新リモートdevelopを基点にCI/CD準備コミットの差分だけを適用。最近のSLO対応を含むリモート側の既存変更を維持し、無関係なローカル履歴を一括pushしない。

`codex-api-smoke.yml` を追加。developから運営者が手動実行し、codex環境の人の承認後に、公式Codex Actionで固定応答 `CODEX_API_OK` だけを要求する。空の一時作業ディレクトリ・read-only・drop-sudoで実行し、ツール実行やファイル参照を要求しない。APIキーはActionだけに渡す。応答の判定は資格情報のない別ランナーで行う。OpenAI API利用料が発生し得る試験であり、モデル・権限・利用枠の確認を含む。自動実装/マージ/公開フラグを有効にしない。

統合コミットの先頭には `[CF-Pages-Skip]` を付け、Pages公開をスキップしつつGitHubのWeb checksを実行する。本番用テンプレートは引き続き無効のまま。Web checks成功後、developのclassic branch protectionでPR必須・最新baseへの追従・GitHub Actionsによる `verify` / `Automation control checks` 成功・管理者も対象・force push/削除禁止を設定する。Codexレビューを自動処理できるよう、人の必須レビュー数は0とし、別実行のCodexレビューと検証環境確認を自動マージジョブの前提に保つ。

統合前のローカル確認：最新リモートdevelop由来の既存801テスト、制御系20テスト、型検査・stagingビルド、8ワークフロー/テンプレートの検査とactionlintが成功。元の作業フォルダの未公開機能を含むテスト件数とは区別する。


統合結果：`d19e3ac` の [Web checks 39518395360](https://github.com/papettoTV/virtual_gamecenter/actions/runs/39518395360) は成功。developにPR必須、最新base、GitHub Actions（App ID 15368）の `verify` / `Automation control checks` 必須、管理者も対象、force push/削除禁止、会話解決必須を適用し、APIで再確認した。人の必須レビュー数は0。mainのSHAは `73cb5d9267c56f06f9f1150327ec6b8b3caa2bb9` のまま維持している。

OpenAIの初回試験39518429088は、人の承認後にCLI起動引数の重複で停止した。固定したCodex Actionが `--skip-git-repo-check` を自動追加するため、workflow側の追加指定を除去し、ローカルの回帰検査にこの契約を追加。モデル応答・APIキーの有効性は、この起動失敗を根拠に合格扱いにしない。修正は保護ルールを迂回せず、develop向けPRと必須チェックを通して取り込む。


## OpenAI APIの実行確認（2026-10-21）

- [修正PR #1](https://github.com/papettoTV/virtual_gamecenter/pull/1)の必須チェック合格後、`6a1856f` としてdevelopへマージ。管理者bypassや保護解除は使用していない。
- [OpenAI固定応答試験 39520165299](https://github.com/papettoTV/virtual_gamecenter/actions/runs/39520165299)は、人がcodex環境を承認した後に成功。公式Codex ActionによるAPI実行と、別ランナーでの `CODEX_API_OK` 完全一致確認の両方が成功した。Secret値は取得・表示していない。
- [マージ後のWeb checks 39520159957](https://github.com/papettoTV/virtual_gamecenter/actions/runs/39520159957)も成功。これはAPI認証と固定応答の試験であり、IssueからPR作成・レビュー・検証環境公開・自動マージまでの通し試験ではない。
- 次の準備はstaging環境と検証専用のCloudflareトークン・Basic認証情報。このAPI試験の時点ではGitHub Environmentsはautomationとcodexだけで、stagingは未作成だった。Cloudflareの設定変更や検証公開はまだ実施していない。
- mainのSHAは引き続き `73cb5d9267c56f06f9f1150327ec6b8b3caa2bb9`。自動化フラグはfalse、本番用テンプレートは無効のまま。


## staging Secretと公開前の接続確認（2026-10-21）

staging Environmentの作成と、`CLOUDFLARE_API_TOKEN`・`PULBASE_CHECK_USERNAME`・`PULBASE_CHECK_PASSWORD` の登録名を確認。値の取得はしていない。承認者はpapettoTV、本人が開始した処理も承認可能、管理者による承認スキップは禁止。利用対象はdevelopと `refs/pull/*/merge` に限定し、mainやタグを許可しない。

手動の `Staging service check` をstaging Environmentに接続する。以前のworkflowはEnvironmentの指定がなく、Environment Secretsを参照できなかった。developからpapettoTVが開始し、人の承認後に次を確認する。

1. Cloudflare APIで固定対象の `pulbase-staging` のscript-settingsと `virtual-gamecenter` のPages設定をGETする。API応答本文や例外の詳細は出力せず、アクセス結果とPagesのPreview自動公開の停止状態だけを記録する。Production branchがmainであることを確認し、変更しない。
2. 別ステップでBasic認証を使い、既存の検証URLに対してサービス確認を行う。新規プレイヤー・クレジット消費・デプロイ・設定更新・本番URLへのアクセスは実施しない。Cloudflare確認が失敗しても、セットアップ成功時にはBasic認証の確認を行う。

CloudflareトークンはAPI確認ステップだけ、Basic認証はサービス確認ステップだけに渡す。この試験でCloudflareの書込権限やデプロイ成功は証明しない。Preview自動公開が有効な場合は事前チェックの結果で示し、検証公開フラグを有効にする前に停止する。現時点で自動化フラグはすべてfalse、クラウドの設定変更・デプロイ・main反映は未実施。
