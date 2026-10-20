# Cloudflareログの保護・保存・閲覧権限

2026-10-20の後続作業でアプリのセキュリティ差分を検証Workerへ反映し、クエリ除去を再適用・保存ログで再確認した。[反映記録](security-staging-release.md)を最新状況として参照。以下の未デプロイという記述は初回点検時点の履歴で、本番は引き続き未変更。

更新：2026-10-20。EN-03 / DL-05の点検。対象は検証Worker `pulbase-staging` とPages Preview。本番公開やアカウント全体の監査完了ではない。

## 実設定の確認と変更

Cloudflare APIで設定・メンバー情報を読み取り、秘密値・利用者ログ本文・メールアドレスは出力しなかった。続いて検証Workerの`script-settings` APIで、URLクエリの除去だけを有効化した。

| 設定 | 変更前 | 変更後 |
| --- | --- | --- |
| `observability.redact_query_string` | false | true |
| ログ収集・保存・invocation logs | すべてtrue | 維持 |
| ログのサンプリング率 | 1 | 維持 |
| トレース収集 | false | 維持 |
| Worker Logpush / Tail Consumer | false / 0件 | 維持 |

PATCH後のGETで、他のobservability項目・Logpush・Tail Consumerが変わらないことを照合した。アプリコード・Secret・DB・Cron・通知・メンバー権限、本番Worker・本番Pages・mainは変更していない。

[公式API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/edit/)では、この設定はログ・トレースの要求URLからクエリを除去するものとされる。consoleの本文やすべてのヘッダーをマスクする設定ではない。別コミットのアプリ側の生例外ログ修正は、今回バックエンドへデプロイしていない。

## 検査・再適用

`apps/web/`で実行する。

```sh
npm run logs:policy -- --environment staging
npm run logs:policy -- --environment staging --apply
```

通常はGETのみで、未保護なら非ゼロ終了。`--apply`のときだけクエリ除去を有効化する。対象アカウント・Worker・APIホストは固定し、本番指定・対象上書き・余分な引数を拒否する。設定欠落・未対応・監視無効化は自動補完せず停止し、適用後に他設定が変わっても失敗扱いにする。

インストール済みWrangler 4.114.0のschemaに`redact_query_string`がないため、未対応フィールドをJSONCへ足して反映済みとは扱わない。**今後のバックエンドデプロイ後は必ず再確認し、未保護なら限定APIで再適用する。** CLIが設定を維持するとは仮定しない。デプロイとの不可分な適用・本番対応はリリース手順の残課題。

## 保存ログでの実効性確認

設定値確認と実ログ確認は分ける。既存Wrangler OAuthと最初のアカウント所有トークンではスキーマ照会が403となり、合成アクセス前に停止した。その後、運営者が個人側のAPI Tokenメニューで同名権限のトークンを作り直し、ローカル保存した資格情報で再実行したところ、スキーマ照会・限定検索とも成功した。この結果だけで、アカウント所有トークン全般が非対応とは断定しない。

2026-10-20、検証Pagesへの合成GETは200。検証Workerの固有パスに一致する保存イベント1件を取得し、合成code/stateの値および`code=`/`state=`がイベント全体にないことをメモリ内で確認した。**検証Workerでの合成データによるクエリ除去を確認済み。** 生URL・イベント本文・秘密値は出力/保存していない。過去ログ・Pagesストリーム・本番や他のログ項目の保護を保証するものではない。

```sh
npm run logs:verify -- --environment staging
```

- `.dev.vars`の`CLOUDFLARE_OBSERVABILITY_TOKEN`と既存の`PULBASE_CHECK_USERNAME` / `PULBASE_CHECK_PASSWORD`を使う。値をGit・チャット・コマンド引数に入れない。
- ログ検索APIも[公式仕様](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/)上は`Workers Observability Write`権限を要求する。運営者が同権限のトークンを作成し、更新後の資格情報で検索成功を確認した。トークン全体の権限・制限の棚卸しまで完了したものではない。既存トークンを勝手に増権しない。
- 権限・フィールド名を先に確認し、失敗時は合成アクセスもしない。検証Pagesへ固有パスと偽物のcode/stateを付けたGETを1件だけ送り、OAuth・アカウント作成・消費には触れない。
- 検証Workerと固有パスのAND検索、`dry: true`、直近5分以内、最大20件・3回に限定。空結果は合格にしない。
- 取得イベントはメモリ内で合成値の有無を検査し、件数・真偽値だけを報告。URL・ログ本文・Cookie・認証値を保存/標準出力しない。

## 保存期間と外部転送

| 対象 | 確認した仕様・運用 | 残課題 |
| --- | --- | --- |
| Workers標準ログ | [現時点の公式仕様](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#pricing)はFree 3日 / Paid 7日で、通常30日以内のアプリ方針に収まる | 適用プラン・将来の仕様変更・他の保存先を公開時と定期レビュー時に照合 |
| Pages Functions | [公式仕様](https://developers.cloudflare.com/pages/functions/debugging-and-logging/#limits)はリアルタイムストリームで標準では永続保存しない。Preview APIにも独立したobservability設定は現れなかった | ストリームの元URL閲覧、手動保存や外部転送は別管理 |
| 調査資料 | 生URL・コード・Cookie・プロフィール本文は保存せず、必要なら固定カテゴリ・集計・時刻に限定し通常30日以内 | 例外保持は理由・担当・期限を記録。GA・X DM・決済記録は別 |
| 過去ログ | 新設定で遡及マスキングされるとは扱わない | 混入が疑われる場合の個別調査・失効・削除判断。今回Cloudflareの既存ログは削除していない |

これは標準ログの確認であり、Cloudflareの全内部記録や外部SNSまでアプリから期限削除できるという宣言ではない。

## 閲覧権限・運営者認証

- メンバー一覧を全1ページ取得し、役割・承認/招待状態を点検。メンバー識別子・メール・個別の認証状態は公開リポジトリへ記録しない。
- 運営者認証の有効化は本人の完了申告とCloudflare APIによる再確認を実施済み。Google SSO利用は本人申告であり、Google側の認証要素・復旧手段の保管まで独立に検証したものではない。復旧手段の本人確認は残す。[公式設定手順](https://developers.cloudflare.com/fundamentals/user-profiles/2fa/)を参照。
- 既存Wrangler OAuthは読み取り専用の最小権限資格情報ではない。今回必要な操作だけに使用し、増権・メンバー作成・トークン交換はしなかった。
- 新たな運営者には最小権限で必要な環境だけを割り当て、ログ閲覧・デプロイ・課金管理を一括付与しない。全APIトークン・CI資格情報の棚卸しは残る。

同日追加：[セキュリティレビュー](security-review.md)でローカル全参照から到達するGit履歴の限定走査、GitHubのSecret件数・Actions権限・deploy key件数、端末の秘密ファイル権限を確認した。履歴の形式/現在の秘密値一致は検出0だが、大容量/バイナリ・到達不能履歴・外部CIログや全Cloudflare/Google資格情報の権限点検まで完了したものではない。

## ローカルの資格情報取得

Wranglerの`auth token --json`がstdoutだけでなく診断ログにも資格情報を出力する実装と確認した。新ツールの子プロセスは`WRANGLER_WRITE_LOGS=false`・`WRANGLER_SEND_METRICS=false`とし、stdout/stderrは親プロセス内でだけ受け取る。

後続点検でPages公開スクリプトにも同じ抑止設定を適用した。壊れたCLI JSONの解析失敗も固定文言に変換し、秘密値を含むJSON断片を例外メッセージへ出さないことをテストした。Pages公開操作は実行していない。

エージェント専用一時ディレクトリで、この資格情報出力を含むCLI診断ログ5件を除去した。秘密値をチャット・Gitへ出力していない。Cloudflareの監査/運用ログやユーザー管理ファイルの削除ではなく、端末全体・他ディレクトリ・Git履歴に漏洩がないことの保証でもない。

## 動作確認と残課題

設定変更後、2026-10-20 12:10 JSTの検証サイト7項目がすべて200（66〜1250ms）。読み取り疎通であり負荷試験ではない。後続確認で運営者認証の有効化と、合成アクセス1件の保存ログでのクエリ除去を確認した。復旧手段、Pagesストリームの取り扱い、過去ログ/外部保存先・全トークン棚卸しは残る。本番・一般公開・長時間負荷試験の判定は変更しない。

ローカルは全694テスト、型検査、stagingビルド成功。追加15テストは対象制限、読み取り/明示適用、監視設定維持、資格情報の診断ログ抑止、APIエラーの非漏洩、合成ログの空結果/未マスク/正常結果を確認する。モックによる正常結果の検査を、Cloudflare保存ログでの実効性確認の代わりにはしない。既存の大きなJSチャンクの警告は残る。
