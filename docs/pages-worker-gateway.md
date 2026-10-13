# Pages → Worker接続

更新：2026-10-13。検証用PagesとWorkerを実際に接続。本番main・Production bindingは変更していない。

## 構成

`develop.virtual-gamecenter.pages.dev` → Pages Advanced Mode `_worker.js` → `BACKEND` Service Binding → `pulbase-staging` → Static Assets / API / D1 / Durable Objects / R2。

- Pages Preview：`APP_ENV=staging`、`BACKEND=pulbase-staging`。
- 本番用の宣言：`APP_ENV=production`、`BACKEND=pulbase-production`。宣言を準備しただけで、本番Worker・Pages Production bindingは未作成/未反映。
- 全パスを転送。Pages独自の静的画面へフォールバックせず、binding未設定・通信例外は503/no-store。認証不足はWorkerの401をそのまま返す。
- URL・Origin・Cookie・Authorization・本文と、Set-Cookie・Location・WebSocketの101応答を維持。Googleの戻り先はPagesのホストになる。
- ゲートウェイ側で環境ヘッダーを上書きし、Workerが環境の取り違えを拒否。検証はdevelopの標準URL、本番はpages.dev本番URLとpulbase.comだけを許可。ハッシュ付きプレビューURLは公開入口にしない。
- Basic認証はWorkerで維持。検証用の資格情報は本番と別に発行しCloudflare Secretに保存。値をGit・資料へ載せない。
- 検証Workerでは解析スクリプトに停止フラグを付け、同意済みでもGoogle Analyticsをロードしない。

## ビルドと公開

- Cloudflareの既存ビルド設定：Root `apps/web`、command `npm run build`、output `dist/client` を維持。
- npm run buildで通常のWorker/clientビルド後、Pagesの `_worker.js` と `_routes.json` を同じclient出力へ生成する。
- Worker Static AssetsからはPages用ファイルを `.assetsignore` で除外。サーバーコードや `.dev.vars` を公開フォルダへコピーしない。
- Pages設定は `apps/web/pages/wrangler.jsonc`。同じファイル名をWorker設定と共存させるため専用ディレクトリに置く。
- `npm run deploy -- staging`：環境別Workerをテスト/ビルド後に公開。
- `npm run deploy:pages -- staging`：Pagesゲートウェイをdevelopだけに公開。Workerのビルドリダイレクトキャッシュを退避/復元し、Pages CLIが変更する共有ビルド設定もデプロイ前の値に復元する。
- mainからproductionを明示したときだけ本番用コマンドを使える。検証公開が本番公開の許可を意味しない。

Wrangler Pagesは任意の設定ファイルパスを受け付けないため、専用ディレクトリで実行する。手動の低レベルCLIは相対出力先をPagesプロジェクトの共有設定に書き戻す場合があるので、上記の保護付きスクリプトを使用する。

## 作成・反映済み

- 検証D1：`pulbase-staging`、全マイグレーション適用済み。既存 `graze-duel-rankings` は変更していない。
- 非公開R2：`pulbase-staging-deletion-audit`。R2の利用開始は運営者が実施。
- Worker：`pulbase-staging`、DO `CabinetRoom`、購入停止・開発者ログイン無効、毎時削除Cron。
- Google OAuthとBasic認証の検証用Secretを登録。Googleの許可URIは `https://develop.virtual-gamecenter.pages.dev/api/platform/auth/google/callback`。
- 検証Pages：deploy alias `develop.virtual-gamecenter.pages.dev`、deployment `fefce738`。mainのProduction branchと既存Production設定は維持。
- PagesのGit連携による再ビルドにも同じgatewayを含める。共有build_configはapps/web/npm run build/dist/clientへ維持。
- developへのpush後、GitHub CI（Web checks）成功。Git連携の再公開 `88d519a1` でも開始/観戦通信を再実測し成功。共有ビルド設定とProduction branch/main・既存Production bindingの維持を確認。

## 検証結果

- 全448テスト：Vitest 54ファイル423件、解析ランタイム11件、公開設定14件。型検査・Worker/client/Pagesビルド成功。
- ローカルの実Worker/D1/DO：認証、Origin/Cookie/本文の保持、Googleの戻り先、クレジット仮確保/消費、ゲーム開始、別観戦者へのフレーム配送、WebSocket応答の透過を確認。
- 実際のdevelop Pages：health、専用ゲストの初回特典・1枚消費、筐体着席、ソロ開始、別WebSocket観戦者へのキーフレーム・移動フレーム配送、解析停止を確認。実測用ゲストは本番ではなく新しい検証DBに作成。
- Google側で検証URIを指定したログイン画面が正常表示され、redirect_uri_mismatchは出ないことを確認。モック上流を使うローカル統合テストでcallback完了・戻り先・プロフィール・5枚+5枚の継承を確認。
- 2026-10-13、運営者から検証環境でGoogleログイン成功の報告を受けた。検証D1を読み取り専用で照会し、Google連携レコードが1件保存されていることを確認。個人情報は取得・記録していない。
- 内蔵ブラウザはBasic認証の入口で接続をブロックしたため、ゲーム画面の実ブラウザ操作は運営者の確認を併用する。ログイン後のプロフィール/残高表示、戻り先、ログアウトと各端末の実機操作は引き続き確認対象。登録特典・継承は上記の自動テストで確認しており、実画面の確認と区別する。

## 残る公開準備

本番リソース、mainへの反映、本番Google設定・ドメイン、監視/通知・復元・乱用対策、実機検証は別作業。検証用Basic認証情報は、このMacで作成した `/tmp/pulbase-staging-access.json` にある。これは一時ファイルなので、安全な管理方法へ移したうえで不要なSecret一時ファイルを削除する。
