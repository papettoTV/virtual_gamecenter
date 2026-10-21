# 人の承認付き本番リリースの準備

更新日：2026-10-21。準備はdevelopだけで行う。mainへのコード反映、本番デプロイ、X投稿は未実施。本番用テンプレートは `.github/workflow-templates/production-release.yml.disabled` のまま維持し、`PULBASE_PRODUCTION_ENABLED` と `PULBASE_X_ENABLED` はfalse。

## 設定済みの承認ゲート

| Environment | 利用元 | 承認 | 用途 |
| --- | --- | --- | --- |
| release-preflight | mainブランチだけ | なし | 候補のテスト・ビルド、検証環境に同じSHAが配信されているかの読取 |
| production | mainブランチだけ | papettoTV必須 | 確認済みSHAのmain反映と本番Worker/Pages公開、公開後の回帰確認 |
| announcement | mainブランチだけ | 初回はpapettoTV必須 | 本番回帰確認成功後のX告知 |

3環境とも管理者によるbypassを禁止し、タグやdevelopからは利用できない。開始者本人による手動承認は可能。承認操作を自動処理が代行しない。production/announcementにはリリース鍵、release-preflightには検証用Basic認証2値の登録名を確認済み。他のSecretは未登録。Environmentがあるだけで本番ワークフローが起動することはない。

## 設定を進める順序

1. 実装用とは別のリリース用GitHub Appを作成し、このrepoだけへインストールする。Repository permissionsはContents: Read and write、Workflows: Read and write、Metadata: Read。Workflowsはworkflowファイルを含むコミットのmain反映に必要。Webhookは不要。App IDを `PULBASE_RELEASE_APP_ID`、秘密鍵をproduction/announcementの `PULBASE_RELEASE_APP_PRIVATE_KEY` として登録する。実装用Appやcodex/staging/automationへ本番鍵を渡さない。
2. リリースAppの認証と権限を公開なしで検証し、そのIDを使ってmain保護を設計・設定する。mainには後述の2つのactiveルールセットを適用済み。実装用Appにはmain更新のbypassを付けない。mainのコードを動かす試験は別途明示指示まで行わない。
3. release-preflightへ検証Basic認証2値を登録する。productionへ本番専用Cloudflareトークンと本番Basic認証2値を登録する。検証と本番のトークン・ユーザー情報を混同しない。
4. 本番Worker/D1/R2/Service Binding/Google OAuth等の存在・分離・必要Secret・移行・バックアップ・復旧手順を確認する。現行設定にはproduction D1の仮IDが残るため、本番構成は未完成。リソース作成やSecret更新はクラウド反映として別途扱い、ローカルビルド成功で完了にしない。
5. X Developer Appを用意する。OAuth 1.0aユーザーコンテキストのRead and Write権限で、実際に告知するアカウントの4資格情報をannouncementへ登録する。必要な契約・利用枠はXのConsoleで確認し、投稿試験は今は行わない。
6. Xの重複投稿防止用 `automation-state` ブランチを公開対象外として準備し、更新権限を本番側のAppに限定する。送信結果不明時は自動再送せず、投稿有無を人が照合する。
7. 既存の `production-launch-checklist.md` の公開判定を確認する。長時間負荷試験等の未完了事項はCI成功だけで合格に変更しない。
8. 別途、main反映・本番公開の明示指示を受けてから、main保護・Pages本番自動公開の経路・固定した候補SHAを最終確認し、本番workflowを有効化する。今回はここへ進まない。

## Secretの対応

| Environment | Secret | 内容 |
| --- | --- | --- |
| release-preflight | PULBASE_CHECK_USERNAME / PULBASE_CHECK_PASSWORD | 検証環境のBasic認証と同じ値。検証URLのSHA確認専用 |
| production | PULBASE_RELEASE_APP_PRIVATE_KEY | リリース専用Appの秘密鍵 |
| production | CLOUDFLARE_API_TOKEN | 本番専用の必要最小権限トークン |
| production | PULBASE_CHECK_USERNAME / PULBASE_CHECK_PASSWORD | 本番Basic認証。一般公開への切替は別変更 |
| announcement | PULBASE_RELEASE_APP_PRIVATE_KEY | 本番側Appの状態記録用認証 |
| announcement | X_API_KEY / X_API_SECRET | X AppのAPI Key / API Key Secret |
| announcement | X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET | 告知アカウントのAccess Token / Access Token Secret |

秘密情報をチャット・Issue・Git・Actionsログに貼らない。GitHubのEnvironment Secret欄へ直接登録する。

## 公開後の検証と告知条件

本番テンプレートは、Worker/Pagesの公開後に両者のSHA一致、HTTPサービス確認、Chromiumのデスクトップ/モバイル回帰確認を行い、結果・HTMLレポート・画面画像を14日保存する。ブラウザ確認では検証用ゲストを作成し、Google実認証やクレジット消費を伴うプレイは行わない。全ゲームの実機性能や既存公開チェックリストを網羅する試験ではない。

回帰確認に失敗した場合はX告知へ進まない。公開の部分失敗時は、main/Worker/Pagesのどこまで反映されたかを調べて復旧を判断する。X投稿の結果不明や投稿後の状態記録失敗も自動再送しない。失敗した告知ジョブだけを扱い、本番公開全体を再実行しない。

公式資料：[GitHub Appの権限](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)、[既存CI/CD手順](codex-cicd-setup.md)。Xの画面・権限・利用枠は設定に進む時点で公式資料とConsoleを再確認する。


## リリースApp認証とmain保護の記録（2026-10-21）

- リリース用App：`pulbase-release` / App ID `5405029`。Repository Variable `PULBASE_RELEASE_APP_ID` に登録。production/announcementの `PULBASE_RELEASE_APP_PRIVATE_KEY`、release-preflightの `PULBASE_CHECK_USERNAME` / `PULBASE_CHECK_PASSWORD` は登録名を確認した。Secret値は取得・表示していない。
- ローカル保存のPEMでJWTによるApp本人・所有者・Contents/Workflows writeとMetadata readの権限宣言を確認。対象repoへのselectedインストール（ID `173600628`）を確認し、`papettoTV/virtual_gamecenter` のcontents/metadata readだけに限定した試験トークンを発行した。repoが1件だけ見えることとmain/developの読取が成功し、試験後にトークンを失効させた。main push・PR作成・デプロイ・X投稿は行っていない。
- これはローカル保存鍵による認証試験。GitHub Secretに保存された値そのものや、書込操作の実行成功を検証したものではない。main限定の本番Environmentをdevelopへ開放して試験することはしない。
- [main-release-app-only](https://github.com/papettoTV/virtual_gamecenter/settings/rules/25520943)：mainの更新主体はIntegration ID `5405029` だけ。このルールの例外はリリースAppだけで、実装Appや管理者ロールの例外はない。
- [main-release-integrity](https://github.com/papettoTV/virtual_gamecenter/settings/rules/25520941)：bypass actorなしで、削除禁止・non-fast-forward禁止、GitHub Actions（Integration ID `15368`）由来の `verify` / `Automation control checks` 必須・strictを全員に適用。リリースAppもこのルールは迂回できない。
- GitHub APIで2ルールがactiveでmainに適用され、mainがprotectedであることを確認した。書込み拒否を確認する目的のmain更新試験は実施していない。リリースAppへ鍵を渡すproductionとannouncementは、人の承認必須・main限定・管理者bypass禁止を維持している。
- main SHAは `73cb5d9267c56f06f9f1150327ec6b8b3caa2bb9` のまま。本番/Xフラグはfalse。本番用テンプレートは無効。本番Cloudflare資格情報・実リソース・X設定等は引き続き未完了。


## 本番Cloudflareリソースの読取棚卸し（2026-10-21）

既存のローカルWrangler OAuth認証で、設定のaccount ID `60e5472a284dc71bbafbbfac8aa2a940` と権限を確認してGETのみを実行した。トークンやAPI応答本文は公開せず、リソースやデータの作成・更新は行っていない。

- `pulbase-production` Workerのscript-settings：HTTP 404 / code 10007。
- `pulbase-production` D1：対象名の照会で該当なし。
- `pulbase-production-deletion-audit` R2：HTTP 404 / code 10006。
- Pages `virtual-gamecenter`：Production branchはmain、Preview自動公開はnone。本番Git自動公開は有効で、ProductionのService Bindingは未設定。

従って、現在は既存の本番Workerを選択してEditor権限だけのトークンを作れる状態ではない。本番専用リソース・設定・Secret・接続を準備し、新規Workerの初回作成に必要な権限と、その後の既存Worker更新の権限を分けて確認する。Pages本番Git自動公開の停止と、本番のService Binding設定変更はまだ実施していない。本番/Xフラグはfalseを維持する。
