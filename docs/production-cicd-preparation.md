# 人の承認付き本番リリースの準備

更新日：2026-10-21。準備はdevelopだけで行う。mainへのコード反映、本番デプロイ、X投稿は未実施。本番用テンプレートは `.github/workflow-templates/production-release.yml.disabled` のまま維持し、`PULBASE_PRODUCTION_ENABLED` と `PULBASE_X_ENABLED` はfalse。

## 設定済みの承認ゲート

| Environment | 利用元 | 承認 | 用途 |
| --- | --- | --- | --- |
| release-preflight | mainブランチだけ | なし | 候補のテスト・ビルド、検証環境に同じSHAが配信されているかの読取 |
| production | mainブランチだけ | papettoTV必須 | 確認済みSHAのmain反映と本番Worker/Pages公開、公開後の回帰確認 |
| announcement（旧設定） | mainブランチだけ | papettoTV必須の設定を保持 | 現在の文面提示ジョブでは利用しない |

3環境とも管理者によるbypassを禁止し、タグやdevelopからは利用できない。開始者本人による手動承認は可能。承認操作を自動処理が代行しない。production/announcementにはリリース鍵、release-preflightには検証用Basic認証2値の登録名を確認済み。productionには本番Basic認証2値と `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` の登録名も確認済み。Cloudflare本番トークンは未登録。Environmentがあるだけで本番ワークフローが起動することはない。

## 設定を進める順序

1. 実装用とは別のリリース用GitHub Appを作成し、このrepoだけへインストールする。Repository permissionsはContents: Read and write、Workflows: Read and write、Metadata: Read。Workflowsはworkflowファイルを含むコミットのmain反映に必要。Webhookは不要。App IDを `PULBASE_RELEASE_APP_ID`、秘密鍵をproductionの `PULBASE_RELEASE_APP_PRIVATE_KEY` として登録する（旧announcement環境へ新規登録する必要はない）。実装用Appやcodex/staging/automationへ本番鍵を渡さない。
2. リリースAppの認証と権限を公開なしで検証し、そのIDを使ってmain保護を設計・設定する。mainには後述の2つのactiveルールセットを適用済み。実装用Appにはmain更新のbypassを付けない。mainのコードを動かす試験は別途明示指示まで行わない。
3. release-preflightへ検証Basic認証2値を登録する。productionへ本番専用Cloudflareトークンと本番Basic認証2値を登録する。検証と本番のトークン・ユーザー情報を混同しない。
4. 本番Worker/D1/R2/Service Binding/Google OAuth等の存在・分離・必要Secret・移行・バックアップ・復旧手順を確認する。本番専用D1/R2は作成・対応付け済みだが、DB移行・Worker・Secret・接続は未完了。リソース作成やSecret更新はクラウド反映として別途扱い、ローカルビルド成功で完了にしない。
5. Xは手動投稿とし、リリース準備時に日本語の告知案を作成・確認する。X Developer App・投稿資格情報は不要。
6. 回帰確認成功後、Actionsサマリーとダウンロード用artifactへ告知文面を提示する。投稿は人が行い、投稿済みかどうかもX上で確認する。投稿状態記録用のブランチは作成しない。
7. 既存の `production-launch-checklist.md` の公開判定を確認する。長時間負荷試験等の未完了事項はCI成功だけで合格に変更しない。
8. 別途、main反映・本番公開の明示指示を受けてから、main保護・Pages本番自動公開の経路・固定した候補SHAを最終確認し、本番workflowを有効化する。今回はここへ進まない。

## Secretの対応

| Environment | Secret | 内容 |
| --- | --- | --- |
| release-preflight | PULBASE_CHECK_USERNAME / PULBASE_CHECK_PASSWORD | 検証環境のBasic認証と同じ値。検証URLのSHA確認専用 |
| production | PULBASE_RELEASE_APP_PRIVATE_KEY | リリース専用Appの秘密鍵 |
| production | CLOUDFLARE_API_TOKEN | 本番専用の必要最小権限トークン |
| production | PULBASE_CHECK_USERNAME / PULBASE_CHECK_PASSWORD | 本番Basic認証。一般公開への切替は別変更 |
| production | GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | 本番用OAuthクライアント。保管済み、Worker側への反映は未実施 |

旧announcement環境は不要となった。既存環境や保管済みのリリース鍵はこの変更で削除せず、現在のworkflowからは参照しない。X用Secretの新規登録は不要。

秘密情報をチャット・Issue・Git・Actionsログに貼らない。GitHubのEnvironment Secret欄へ直接登録する。

## 公開後の検証と告知条件

本番テンプレートは、Worker/Pagesの公開後に両者のSHA一致、HTTPサービス確認、Chromiumのデスクトップ/モバイル回帰確認を行い、結果・HTMLレポート・画面画像を14日保存する。ブラウザ確認では検証用ゲストを作成し、Google実認証やクレジット消費を伴うプレイは行わない。全ゲームの実機性能や既存公開チェックリストを網羅する試験ではない。

回帰確認に失敗した場合は手動投稿用の成功文面を提示しない。公開の部分失敗時は、main/Worker/Pagesのどこまで反映されたかを調べて復旧を判断する。成功時はActionsサマリーと `manual-release-announcement-<SHA>` artifactのテキスト/Markdownを提示し、運営者がXへ手動投稿する。文面生成に失敗した場合は文面生成ジョブだけを再実行し、本番公開全体を再実行しない。

文面提示にX App・APIキー・ユーザートークン・announcement環境・投稿状態記録ブランチは不要。リリース準備時にCodexが用意し人が確認した日本語の告知案を、workflowの `announcement` 入力へ渡す。CIは文面を整形・保存するだけで、Xへ送信しない。

公式資料：[GitHub Appの権限](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)、[既存CI/CD手順](codex-cicd-setup.md)。Xの開発者設定・課金・投稿API連携は手動投稿への方針変更により準備対象外。


## リリースApp認証とmain保護の記録（2026-10-21）

- リリース用App：`pulbase-release` / App ID `5405029`。Repository Variable `PULBASE_RELEASE_APP_ID` に登録。production/announcementの `PULBASE_RELEASE_APP_PRIVATE_KEY`、release-preflightの `PULBASE_CHECK_USERNAME` / `PULBASE_CHECK_PASSWORD` は登録名を確認した。Secret値は取得・表示していない。
- ローカル保存のPEMでJWTによるApp本人・所有者・Contents/Workflows writeとMetadata readの権限宣言を確認。対象repoへのselectedインストール（ID `173600628`）を確認し、`papettoTV/virtual_gamecenter` のcontents/metadata readだけに限定した試験トークンを発行した。repoが1件だけ見えることとmain/developの読取が成功し、試験後にトークンを失効させた。main push・PR作成・デプロイ・X投稿は行っていない。
- これはローカル保存鍵による認証試験。GitHub Secretに保存された値そのものや、書込操作の実行成功を検証したものではない。main限定の本番Environmentをdevelopへ開放して試験することはしない。
- [main-release-app-only](https://github.com/papettoTV/virtual_gamecenter/settings/rules/25520943)：mainの更新主体はIntegration ID `5405029` だけ。このルールの例外はリリースAppだけで、実装Appや管理者ロールの例外はない。
- [main-release-integrity](https://github.com/papettoTV/virtual_gamecenter/settings/rules/25520941)：bypass actorなしで、削除禁止・non-fast-forward禁止、GitHub Actions（Integration ID `15368`）由来の `verify` / `Automation control checks` 必須・strictを全員に適用。リリースAppもこのルールは迂回できない。
- GitHub APIで2ルールがactiveでmainに適用され、mainがprotectedであることを確認した。書込み拒否を確認する目的のmain更新試験は実施していない。リリースAppへ鍵を渡すproductionとannouncementは、人の承認必須・main限定・管理者bypass禁止を維持している。
- main SHAは `73cb5d9267c56f06f9f1150327ec6b8b3caa2bb9` のまま。本番/Xフラグはfalse。本番用テンプレートは無効。本番Cloudflare資格情報・実リソース・X設定等は引き続き未完了。


## 作成前の本番Cloudflareリソース棚卸し（2026-10-21）

既存のローカルWrangler OAuth認証で、設定のaccount ID `60e5472a284dc71bbafbbfac8aa2a940` と権限を確認してGETのみを実行した。トークンやAPI応答本文は公開せず、リソースやデータの作成・更新は行っていない。

- `pulbase-production` Workerのscript-settings：HTTP 404 / code 10007。
- `pulbase-production` D1：対象名の照会で該当なし。
- `pulbase-production-deletion-audit` R2：HTTP 404 / code 10006。
- Pages `virtual-gamecenter`：Production branchはmain、Preview自動公開はnone。本番Git自動公開は有効で、ProductionのService Bindingは未設定。

この時点では、既存の本番Workerを選択してEditor権限だけのトークンを作れる状態ではない。本番専用リソース・設定・Secret・接続を準備し、新規Workerの初回作成に必要な権限と、その後の既存Worker更新の権限を分けて確認する。Pages本番Git自動公開の停止と、本番のService Binding設定変更はまだ実施していない。本番/Xフラグはfalseを維持する。


## 本番専用D1・非公開R2の作成（2026-10-21）

ユーザーの指示に基づき、アカウント `60e5472a284dc71bbafbbfac8aa2a940` に次の2リソースだけを新規作成した。既存の検証・旧環境のデータやSecretはコピーしていない。

| リソース | 実体・設定 | 確認結果 |
| --- | --- | --- |
| D1 | `pulbase-production` / `af463342-06e5-4904-97fc-6569d59ceec3` / APAC | 名前とUUIDをAPIで照合、テーブル数0、移行未適用 |
| R2 | `pulbase-production-deletion-audit` / APAC location hint / Standard | managed domain（r2.dev）無効、custom domainsは0件 |
| Worker | `pulbase-production` | script-settingsは404 / code 10007。未作成・未デプロイ |
| Pages | `virtual-gamecenter` | Production branchはmain、Preview自動公開はnone、本番Git自動公開は有効、Production Service Binding未設定 |

`apps/web/wrangler.jsonc` のproduction DB binding `DB`へ実UUIDを設定した。R2 binding `DELETION_AUDIT`、Worker/DO/Rate Limitingの環境分離、workers.dev無効、公開routeなし、開発者ログイン無効、新規購入停止を維持する。本番だけLogsを有効・100%、Tracesを有効・1%に設定した。本番の `analytics_engine_datasets` は空配列を明示し、生成物の検証でも検証用集計の混入を拒否する。これはdevelop上の構成宣言で、稼働環境への適用ではない。設定根拠：[Cloudflare公式Traces設定](https://developers.cloudflare.com/workers/observability/traces/)。

Workerのデプロイ、D1リモート移行、Worker Secretの登録、Pages/DNS変更、main更新、本番公開、X投稿はこの作業では実行しない。Worker Secretの `wrangler secret put` もデプロイを伴うため、今は使わない。GitHubのproduction/announcementの承認必須と、本番/Xフラグfalseを維持する。

### 次の操作：本番用Basic認証をGitHubへ保管する

1. 検証とは別の本番用ユーザー名と十分に長いランダムなパスワードをパスワード管理ツールで作成する。
2. [GitHub Environments](https://github.com/papettoTV/virtual_gamecenter/settings/environments) → `production` → Add environment secret に、`PULBASE_CHECK_USERNAME` と `PULBASE_CHECK_PASSWORD` を登録する。
3. 値はチャットへ貼らない。GitHub登録後、こちらでは登録名だけを確認する。この操作自体はWorkerを作成・公開しない。

これらは公開後の回帰テスト用Secretであり、Worker側の `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD` の登録ではない。同じ本番用値をWorker側へ設定する操作は、初回デプロイの明示指示時に扱う。検証用値をそのままコピーしない。

### その後の準備と未実施項目

- 本番Google OAuth clientを準備し、正規URLとcallback URLを確認する。`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` はWorker初回作成時の安全な登録方法と合わせて別途扱う。
- 本番専用Cloudflare API Tokenは初回Worker作成に必要な権限と継続更新用権限を区別し、対象アカウントへ限定する。GitHub productionへの登録はデプロイとは別操作として案内する。
- D1移行は適用予定ファイル・対象UUID・復旧手順を確認したうえで別途許可を受ける。現時点でアプリのSQLが動くDBではない。
- 初回デプロイ前にログのクエリ除去設定、ログ/トレースに保存される認証情報等の範囲、監視と復旧を確認する。トレース有効の宣言だけで秘匿確認済みとはしない。
- Pages本番Git自動公開の停止とProduction Service Bindingの設定は、mainへの反映・本番公開を明示的に指示された段階で実施する。
- Xは手動投稿。資格情報や状態ブランチの準備を取りやめ、公開後の回帰成功時に文面だけ提示する。


### 公開を伴わない設定検証

- 自動化の既存25テスト、workflow構造8件、actionlint、公開設定/Pages対応18テストに合格。
- `npm run build:production` で型生成・型検査・Worker/Pagesビルド・本番成果物の環境/DB/R2/監視設定の照合に合格。生成型に差分なし。
- 生成した本番設定を指定した `wrangler deploy --dry-run` が正常終了し、DB/R2/DO/Rate Limitingの接続宣言を確認。Workerのuploadは実行していない。
- 本番Basic認証Secret未登録の警告と既存のThree.js大容量チャンク警告は残る。ビルド合格を本番公開可能の判定にはしない。
- この準備差分をdevelopへ取り込む間は `PULBASE_STAGING_DEPLOY_ENABLED` を一時falseにし、pushによる検証Worker公開がスキップされたことを確認してからtrueへ戻す。設定準備のために検証Workerもデプロイしない。


## Xを手動投稿へ変更（2026-10-21）

ユーザーの指示により、Xへの自動送信とOAuth署名・投稿状態の書込処理を削除した。本番テンプレートは無効のまま。公開前は確認用の告知案、公開・回帰テスト成功後は手動投稿用の文面を提示する。Xへの送信は行わない。文面提示ジョブにはSecretもGitHub書込トークンも渡さない。Workerデプロイ・main反映・本番公開はこの変更では行わない。
