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

宣言上の対象は、アカウント60e5472a284dc71bbafbbfac8aa2a940、Worker pulbase-production、D1 pulbase-production（af463342-06e5-4904-97fc-6569d59ceec3）、非公開R2 pulbase-production-deletion-audit、Pages virtual-gamecenterのmain/pulbase.com。検証リソースとの分離宣言はローカルで確認する。2026-10-28に管理用画面でWorker未作成・本番D1ありとの運営者報告を受けた。D1の現在の中身・移行履歴は再取得していない。本番R2のSettingsはブラウザで読み取り、Custom Domainsの割当なし・Public Development URL無効を確認した。リソース・公開設定は変更していない。

新規Worker作成にはWorkers product scopeのAdminが必要で、既存Worker向けEditorでは作成できない。初回作成は人が保管する一時的な管理認証と継続デプロイ認証を分けて計画し、作成権限を持つ広い鍵をCodexや通常CIへ登録しない。既存Workerになった後の継続認証は、そのWorkerだけのEditorと必要なPages権限を確認する。Workerのbindingを公開するだけなら、D1/R2の直接操作権限を追加する理由にはしない。

Worker Secretのput/deleteはデプロイを伴うため今回行わない。必要な本番Basic/OAuthの値はGitHub保管のまま保持し、初回作成時の同時設定方法を別途確認する。本番D1への移行、Pages Production binding・DNS・公開URL・稼働中設定の変更も行わない。

根拠：[Workersの権限](https://developers.cloudflare.com/workers/authorization/workers/)、[Secret操作とデプロイ](https://developers.cloudflare.com/workers/configuration/secrets/)。dry-runは固定Wrangler 4.114.0のhelpと実行結果で確認する。

## 公開判断前に別途必要なこと

- 本番も固定された制御コードから起動し、人が承認した同一SHAだけを扱う経路を確定する。残存する旧テンプレートをそのまま有効化しない。
- main昇格の権限と本番Environmentの利用元を、その設計に合わせて確認する。今回は例外追加や保護解除を行わない。
- 初回Worker作成、D1移行、Secret反映、Pages接続、実回帰、復旧を作業ごとに判断する。
- production-launch-checklistの未合格・負荷・実機・運営判断をビルド成功で完了にしない。
- 公開後に回帰が成功した場合だけ告知文を提示し、人がXへ投稿する。X資格情報は不要。

現段階で「公開可能」とは判定しない。トークン発行・main反映・デプロイの承認は求めない。

## 設定の再監査（公開なし）

`node ci/production-settings-audit.mjs` は既存の開発用GitHub CLI認証で、固定リポジトリの許可済みGETだけを実行する。任意のAPI・書込メソッド・トークン入力・Cloudflare操作は提供しない。APIの読取が拒否された場合も、認証を増権せず停止する。

点検するものは、本番フラグfalse、準備開始時のmain SHA、mainの更新禁止・必須CI・削除/force push禁止、ci-controlの変更禁止、両ルールのbypass空、productionの人による承認・管理者bypass禁止・Branch型main限定、productionのSecret名5件、同名の本番鍵が他の既知Environment/Repository Secretにないこと。2026-10-28の実API読取で合格した。Secret値の取得、認証試験、設定更新は行っていない。

結果は`ci/results/production-settings-audit.json`。失敗時は以前の成功JSONを残さず終了する。日時つきの観測記録であり、将来のリリース承認や権限の証明には使わない。別名の鍵・管理用端末・他の認証経路の不存在は証明しない。productionReadyは常にfalse。workflowには接続せず、CIでは偽API応答による拒否条件だけをテストする。

## Google OAuthの準備状況（運営者確認）

2026-10-28の管理用画面操作の報告に基づく。以下はSecret値や実Googleログインの検証ではない。

- 種類はウェブアプリケーション。ユーザーの種類は外部、公開ステータスはテストのまま。
- 承認済みリダイレクトURIは`https://pulbase.com/api/platform/auth/google/callback`と`https://virtual-gamecenter.pages.dev/api/platform/auth/google/callback`。
- データアクセスは`openid`、`https://www.googleapis.com/auth/userinfo.email`、`https://www.googleapis.com/auth/userinfo.profile`の3件を登録済みとの報告。コードも基本情報の`openid profile email`だけを要求する。
- サポート/連絡先メールは設定済み、承認済みドメインに`pulbase.com`あり。メールアドレス・Client ID・Client secretは収集しない。
- ホームページ`https://pulbase.com/`、プライバシー`https://pulbase.com/legal/privacy.html`、利用規約`https://pulbase.com/legal/terms.html`を保存済みとの報告。
- 法務ページのファイルはリポジトリ内にあるが、Web読取ツールから現本番URLを取得できず、外部からの表示成功は未確認。コードの存在だけで審査要件を満たすとは扱わない。
- Search Consoleには確認済みの所有者の表示があるとの運営者報告を受けた。プロパティ形式や所有者情報は取得していない。アプリ名の現在値は未確認。審査申請・ブランド公開・アプリ公開は行っていない。

基本情報だけの要求はGoogleのテストユーザー制限の例外になるため、テスト状態を招待者限定のアクセス境界にしない。本番のアクセス境界は既存のBasic認証等として別途検証する。

根拠：[Googleの対象ユーザー](https://support.google.com/cloud/answer/15549945)、[ブランド設定](https://support.google.com/cloud/answer/15549049)、[同意画面とスコープ](https://developers.google.com/workspace/guides/configure-oauth-consent)。

## 残作業の境界

| 作業 | 公開なしで準備できる範囲 | 今回実行しないこと |
| --- | --- | --- |
| 本番の固定制御 | 承認対象SHA・成功CI・検証公開/回帰の証跡・古い候補の拒否を鍵なしで設計/テストする | production Environmentの許可元変更、mainのbypass追加、有効な公開workflow登録 |
| 初回構築 | Worker作成、D1移行、Secret同時反映、Pages接続の手順と必要権限を整理する | Worker作成、リモート移行、Secret put、Cloudflare書込鍵の発行/登録 |
| 継続公開 | 固定成果物・失敗時停止・公開後回帰・復旧判断の手順を準備する | 本番へのHTTP/ブラウザ回帰、公開・巻き戻し |
| 告知 | 未公開の文面ひな型や手動投稿の手順を作る | X資格情報の登録・X投稿・未公開状態で公開成功と告知すること |

本番候補の証跡照合とデータだけの模擬リリースをdevelop向けに準備する。詳細は[本番候補の鍵なし照合](production-candidate-keyless.md)。保護されたci-controlへの配置と実処理・権限の接続は未実施。既存stagingの成功を本番経路の成功とは扱わず、旧テンプレートの有効化や変数trueへの変更で代用しない。ci-controlへの配置や本番保護の変更が必要になる時点で、人の管理操作を別途案内する。
