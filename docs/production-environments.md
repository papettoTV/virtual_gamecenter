# 無料ベータの公開環境とリリース手順

更新日：2026-10-13。今回の作業はリポジトリ内の準備のみ。Cloudflare上の作成・移行・Secret登録・デプロイ・一般公開は未実施。

## 確定した公開先とブランチ

- Pages本番：`https://virtual-gamecenter.pages.dev/`、`main`。`https://pulbase.com/`は同じPages本番のカスタムドメイン。Workerにpulbase.comを直接割り当てる以前の案は撤回する。
- Pages検証：`https://develop.virtual-gamecenter.pages.dev/`、`develop`。通常の開発・pushはdevelopで行い、本番へのmainマージ/pushは明示的なリリース指示がある場合だけ行う。stgではなく標準のブランチエイリアスを使用する。実稼働の確認は別途必要。
- GitHubにdevelopがなかったため、ローカルの未pushの10コミットを維持してmainからdevelopを作成した。origin/mainへは反映しない。
- Workerの公開・リモート移行もブランチを確認する。本番はmain、検証はdevelop以外から拒否。ビルド・設定確認はレビュー用に両環境を実行できる。

### PagesのURLを維持するための接続（未実装・未設定）

現行アプリはWorkers Static Assets/API/Durable Objects/Cronを統合したWorker構成であり、静的ファイルをPagesへ置くだけではAPI・観戦・定期削除まで動かない。検証Workerをそのままpages.devへ割り当てる設定も今回追加していない。

本番・検証とも、Pagesを入口に残し、Pages FunctionsのゲートウェイからService Bindingで各環境のWorkerへリクエストを転送する構成を準備する。ゲーム画面・API・観戦通信を同じ環境URLから使い、筐体DOと削除CronはWorker側に残す。PagesのProduction bindingはpulbase-production、Preview bindingはpulbase-stagingとし、DB/R2/認証を共有しない。ゲートウェイ、WebSocket/Origin/Google戻り先の検証、Pages側binding/ビルド設定は次の作業。

Pagesの **Production branchはmainのまま**。developはPreview対象にする。標準のブランチエイリアス `develop.virtual-gamecenter.pages.dev` を使用し、stgブランチや追加のstgエイリアスは作成しない。Production branchをdevelopへ変えない。

GitHub Actionsはmain/developへのpushと、それらを対象とするPRでテスト・対応表検査・環境別ビルドを実行する。main向けはproduction、develop向けはstaging。PRでは対象ブランチで判断する。Cloudflare認証情報を使った自動デプロイは追加しない。PagesのGit連携による自動公開は別の仕組みであり、GitHubのテスト成功が自動的にPages公開の前提条件になるわけではない。

対応表は `apps/web/config/pages-targets.json`。これはCI用の宣言で、Cloudflare管理画面を変更する設定ファイルではない。CIのnpm run buildはWorker統合アプリのコンパイル検証であり、その出力を静的Pagesへ置くだけでバックエンドも動くことを意味しない。

参考：[Pages Service Bindings / Durable Objects](https://developers.cloudflare.com/pages/functions/bindings/)。Pages内では筐体DOを作成/デプロイせずWorker側へ分離する。

## 前回の棚卸し（公開先決定前）

従来はローカル/公開に同じ `wrangler.jsonc` のルート設定を使用していた。ルートには既存D1のID、開発者ログイン有効、購入停止、削除証跡R2、毎時Cronがある。既存クラウドの実状態・ドメイン・移行適用状況・Secretの設定値は確認していない。READMEに残っていた旧Pages/API URLを現在の公開先とみなさない。

これからの標準は、ローカル、検証、限定公開する本番の3環境。既存クラウド環境の移行/廃止/データ引継ぎは運営者の判断後に実施し、無断で変更しない。

| 項目 | ローカル（ルート設定） | 検証 `staging` | 本番 `production` |
| --- | --- | --- | --- |
| Worker | 既存名のローカルエミュレーション | `pulbase-staging` | `pulbase-production` |
| D1 | `.wrangler`内のローカルDB | `pulbase-staging`（未作成） | `pulbase-production`（未作成） |
| R2 | ローカルエミュレーション | `pulbase-staging-deletion-audit`（未作成） | `pulbase-production-deletion-audit`（未作成） |
| Durable Objects | ローカル筐体 | 検証Workerの筐体 | 本番Workerの筐体 |
| Google OAuth | 開発者ログイン/ローカル設定 | 専用のGoogle OAuth client | 本番用Google OAuth client |
| 開発者ログイン | 有効 | 無効 | 無効 |
| 新規購入 | 停止 | 停止 | 停止 |
| サイト閲覧 | localhost/LAN | Basic認証を維持 | 当面Basic認証を維持 |
| 削除Cron | テスト/手動検証 | 毎時 | 毎時 |

D1の環境別IDは意図的な仮値。リソースの存在を意味せず、公開用チェックは失敗する。この状態ではリリースやリモート移行を進めない。ローカルの保存場所・既存DB IDは変更していない。

## 今回用意した安全策

- `npm run release:check -- staging|production`：環境を明示し、DB/Worker/R2の共用、仮DB ID、開発者ログイン/購入の有効化、必須Secret宣言、定期削除・監視・静的画面の認証経由設定をチェックする。
- `npm run deploy` / `npm run db:migrate:remote` は環境未指定で拒否。環境を指定しても未設定の仮DB IDは拒否する。
- `npm run build:staging` / `npm run build:production` は設定検証後、ビルド時に `CLOUDFLARE_ENV` を選択。生成物のWorker/DB/R2/安全フラグを確認し、プレビュー用に生成された `.dev.vars` を公開用Worker成果物から除去する。
- `npm run deploy -- staging|production` は全テスト、環境別ビルド、生成物確認の後に指定成果物をデプロイする。CIはテスト/ビルドだけで、Cloudflare認証情報や自動デプロイを設定しない。
- `.dev.vars` はローカル用。クラウドのSecretは環境ごとに別途登録。秘密値を資料・Git・CIへコピーしない。CIは固定のダミー値だけを使用する。
- これらはnpm経由の誤操作防止であり、直接の `npx wrangler` や管理画面の操作まで禁止する権限境界ではない。クラウド権限・公開判定は別途必要。

## 次の作業：判断・リソース作成（未実施）

1. 本番はPagesのmainとpulbase.com、検証はdevelopと標準develop URLと確定。pulbase.comはPages側で管理する。環境別バックエンドWorkerは公開routesなし・workers.dev無効でService Bindingから利用する。PagesカスタムドメインとDNSの実設定は未確認。
2. Pages Production/Previewから各Workerへの接続を準備する。既存DB/R2/認証/台帳を引き継ぐかは実際のbindingを棚卸しして決め、未確認のIDやテストデータを本番へコピーしない。
3. 対象Cloudflareアカウントと権限を確認する。既存環境のデータ・バックアップ・適用済み移行を確認し、必要なら保存/移行を別計画にする。
4. 検証用D1と非公開R2を作成し、実際のD1 IDを `env.staging` へ設定。公開バケット機能や公開アクセスは有効にしない。Basic認証と検証Google OAuthのSecretを登録する。
5. `release:check -- staging` が成功したら、対象DB名を確認して全マイグレーションを適用。検証環境へ限定公開し、特典・ログイン・観戦・退会・Cron・復元を検証する。
6. 同じ流れで本番専用D1/R2/Secretを準備。本番DBへテストプレイヤーや開発者アカウントをコピーしない。旧環境の実購入残高を引き継ぐ必要がある場合は、専用の移行・照合手順を先に作る。

環境別に必要なSecretは `BASIC_AUTH_USERNAME`、`BASIC_AUTH_PASSWORD`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。検証と本番のGoogle戻り先はそれぞれ `https://<環境のホスト>/api/platform/auth/google/callback`。`.dev.vars` のダミー・開発者アカウントを本番Google設定として扱わない。

本番でpulbase.comとpages.devの両方からログインを許可する場合は、Googleの戻り先も両方を確認する。エイリアスが同じPagesコンテンツでもCookie/解析同意はホスト単位であり、自動的に同じ端末残高やログイン状態を共有するとは考えない。正規URLと転送の扱いは別途決める。

pulbase.comはPagesプロジェクトのCustom domainsから関連付けたうえでDNSを設定する。DNSのCNAMEを追加するだけではPagesへの関連付けにならない。根拠：[Pagesカスタムドメイン設定](https://developers.cloudflare.com/pages/configuration/custom-domains/)。今回この管理画面/DNS設定は実行していない。

無料ベータ新設環境にはStripeを必須にしない。既存決済の照合が必要な環境では、署名用Secret・送信先・台帳の対応を別途維持する。新規購入停止を解除する理由にはしない。

## コマンド（運営者による実施判断後のみ）

`apps/web` で実行。次の移行・deployコマンドはクラウドを書き換えるため、今回の作業では実行していない。

```bash
npm run release:check -- staging
npm run db:migrate:remote -- staging
npm run build:staging
npm run deploy -- staging
```

本番は `staging` を `production` に置き換える。DB移行はWorkerのデプロイと別操作であり、デプロイのたびに自動実行しない。スキーマ互換性とバックアップ、失敗時の復元・削除再適用手順を確認してから移行する。Workerだけの巻き戻しでDBも巻き戻るとは考えない。

限定公開の確認後に、Basic認証の一般公開切替を別変更としてレビューする。現在の認証コードはSecret未設定で503を返すため、Secretを消すだけでは一般公開にならない。また、一部の共有画像/結果や計測入口は既存設計でBasic認証より先に処理されるため、Basic認証を全コンテンツの完全な非公開保証とは扱わず、EN-03で公開範囲を確認する。

## ローカル検証の証跡（2026-10-13）

Pages構成への変更：標準developプレビューURLとmain本番/canonicalドメインをCIの対応表に追加。全438テスト（Vitest414、解析10、公開設定/Pages対応14）とビルドを検証。CIは検証・本番の両方のWorker設定を選択できるが、GitHub上での実行とPages接続の稼働確認は未実施。Workerの公開routesを廃止し、pulbase.comはPagesで管理する。

公開先決定後：developへの切替、ドメイン・CI対象ブランチ・公開元ブランチチェックを追加。全435テスト（Vitest414、解析10、公開設定11）とローカルビルド成功。Pagesゲートウェイは未実装であり、今回のpushはGitブランチの整備であって、検証サイトの最新アプリ稼働確認ではない。

- 全テスト433件成功：Vitest 53ファイル・414件、解析ランタイム10件、公開設定チェック9件。
- ローカル、staging、productionの3設定で型検査・ビルド成功。未作成の仮リソースのまま環境別コンパイルを確認しただけで、デプロイはしていない。最後にローカル用ビルドへ戻した。
- 環境別成果物のWorker名、DB/R2、開発者認証/購入停止フラグを照合。プレビュー用 `.dev.vars` は検証・本番の生成物から除去した。
- 環境未指定のdeploy/リモート移行と仮DB IDのrelease:checkが、クラウド操作前に失敗することを確認。
- 環境別ビルドではBasic認証Secret未設定の警告が出る。クラウドSecret登録は未完了であり、ビルド成功を公開可能の意味にしない。既存のThree.js大容量チャンク警告も残る。
- GitHub上でのCI実行は未確認。クラウドリソースの存在・権限・接続、Google本番認証、実際のリリース/復元は未検証。

## 公開判定は別チェック

この資料の準備だけでは公開可と判定しない。問い合わせ手段・正式運営情報、素材の権利、GA設定と本番通信、安全性・乱用・費用監視、障害通知、D1 Time Travel/削除再適用、PC/スマホの実機確認が残る。詳細は [本番運用チェックリスト](production-launch-checklist.md)。

特に検証環境では、本番GAへのイベント混入を防ぐタグ停止または検証用プロパティの分離を、限定公開前に確認する。環境別Worker設定の追加だけでは、既存の共通GAタグまで自動的に分離されない。

技術仕様の根拠：[Cloudflare Vite環境選択](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/)、[環境別binding/Secret](https://developers.cloudflare.com/workers/wrangler/environments/)。Viteでは環境をビルド時に選ぶ。生成済み成果物にdeploy時の `--env` を後付けして環境を変更しない。
