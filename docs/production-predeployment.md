# 本番を変更しない準備（2026-10-28）

## 今回進める範囲

production-preparation workflowは、develop向けPRまたはdevelopでの手動実行で、本番構成の静的検査・空DB移行のローカルリハーサル・本番ビルド・Worker dry-run・ブラウザ定義の読込だけを行う。Environment・Secret・GitHub書込権限は持たず、mainへのpush・本番Worker/Pagesへのupload・本番DB操作・本番URLの閲覧・X投稿は行わない。既存の本番リリーステンプレートは無効のまま。

`node ci/production-preparation.mjs build` で同じ検査を行える。アプリの追跡済みファイルを一時ディレクトリに展開し、既存HOME/Cloudflare認証/.dev.varsを使わず、固定ダミー値だけを使用する。生成型とビルド出力は一時コピー内に作り、Worker dry-run後に削除する。秘密値やWorker成果物そのものをGitHub artifactへ保存しない。

SQL25件はメモリ内SQLiteにだけ適用し、整合性・外部キー・ファイル一覧とSHA-256を記録する。外部DBファイルへのATTACHや拡張読込は拒否する。これは実Cloudflare D1での実行、既存データを伴う移行、バックアップ・復元の成功を意味しない。

結果JSONはci/results/production-preparation.jsonとGitHub artifactに保存する。buildPassed/workerDryRunPassedがtrueでもproductionReadyはfalseのまま。ブラウザは--listだけで、実回帰や本番へのHTTP要求を行わない。

## GitHub設定の読取確認

- PULBASE_PRODUCTION_ENABLED=false、production workflowは未登録/無効テンプレートのまま。
- main更新ルールはActive・bypassゼロ。現状はrelease Appにもmain更新を許していない。
- production EnvironmentはBranch型mainだけ、papettoTV承認必須・管理者bypass禁止。
- productionの登録名はPULBASE_RELEASE_APP_PRIVATE_KEY、PULBASE_CHECK_USERNAME、PULBASE_CHECK_PASSWORD、GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRETの5件。値・有効性は取得/検証していない。
- release-preflightの検証Basic認証2件は登録済み。
- 本番Cloudflareトークンは未登録。現在のstaging認証を流用しない。

今回はmain保護・bypass・許可ブランチ・本番Secretを変更しない。productionとannouncementをdevelopへ開放して鍵を使う試験もしない。

## リソース・認証の残作業

宣言上の対象は、アカウント60e5472a284dc71bbafbbfac8aa2a940、Worker pulbase-production、D1 pulbase-production（af463342-06e5-4904-97fc-6569d59ceec3）、非公開R2 pulbase-production-deletion-audit、Pages virtual-gamecenterのmain/pulbase.com。検証リソースとの分離宣言はローカルで確認する。クラウドの最新存在・非公開状態は管理用画面で別途確認する。

新規Worker作成にはWorkers product scopeのAdminが必要で、既存Worker向けEditorでは作成できない。初回作成は人が保管する一時的な管理認証と継続デプロイ認証を分けて計画し、作成権限を持つ広い鍵をCodexや通常CIへ登録しない。既存Workerになった後の継続認証は、そのWorkerだけのEditorと必要なPages権限を確認する。Workerのbindingを公開するだけなら、D1/R2の直接操作権限を追加する理由にはしない。

Worker Secretのput/deleteはデプロイを伴うため今回行わない。必要な本番Basic/OAuthの値はGitHub保管のまま保持し、初回作成時の同時設定方法を別途確認する。本番D1への移行、Pages Production binding・DNS・公開URL・稼働中設定の変更も行わない。

根拠：[Workersの権限](https://developers.cloudflare.com/workers/authorization/workers/)、[Secret操作とデプロイ](https://developers.cloudflare.com/workers/configuration/secrets/)。dry-runは固定Wrangler 4.114.0のhelpと実行結果で確認する。

## 公開判断前に別途必要なこと

- 本番も固定された制御コードから起動し、人が承認した同一SHAだけを扱う経路を確定する。残存する旧テンプレートをそのまま有効化しない。
- main昇格の権限と本番Environmentの利用元を、その設計に合わせて確認する。今回は例外追加や保護解除を行わない。
- 初回Worker作成、D1移行、Secret反映、Pages接続、実回帰、復旧を作業ごとに判断する。
- production-launch-checklistの未合格・負荷・実機・運営判断をビルド成功で完了にしない。
- 公開後に回帰が成功した場合だけ告知文を提示し、人がXへ投稿する。X資格情報は不要。

現段階で「公開可能」とは判定しない。次の人の操作は、まずCloudflare管理画面での存在・公開設定の読取確認だけ。トークン発行・main反映・デプロイの承認は求めない。
