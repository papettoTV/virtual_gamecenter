# 検証CIと公開ジョブの分離

2026-10-21。対象はdevelopと自動PRの検証公開。本番テンプレートは無効のまま維持し、main・本番公開・X投稿は扱わない。

## 実行順序

1. `Web checks` の `verify` がテスト、DOT WAVEの追加安定性確認、SHA付きstagingビルドを行う。Cloudflare・Basic認証・OpenAI・本番用のEnvironment Secretは渡さない。
2. `staging-artifact.mjs` がWorkerのコンパイル済みJS/WasmとPages配信物をパッケージ化する。コミットSHA・Git tree・CI run ID・attemptと各ファイルのSHA-256をmanifestへ保存する。生成されたWrangler設定やWorkerの `.dev.vars` は移送しない。配信物内の隠しファイル（必要な `.assetsignore` を除く）、シンボリックリンクや秘密ファイルは拒否する。
3. developの公開は `Web checks` の成功したpush実行を受けて開始する。自動PRではHeadの必須CIが成功し、そのCIの成果物が同じ合成マージSHAであることを確認して独立Codexレビューへ進む。
4. 新しいランナーの `staging` ジョブが、指定したCI runの固定artifact IDをダウンロードする。別の成功run・別SHA・別attempt・期限切れ成果物へのフォールバックはしない。
5. 公開側は信頼した制御コードとlockfileからツールを導入する。自動PRでは検証済みのBase、developでは該当のdevelopコミットを使用する。`npm ci --ignore-scripts` でlifecycle scriptを実行せず、候補のテスト・ビルド・package scriptを公開ランナーで実行しない。
6. Workerの公開設定は制御側のstaging専用設定から構成し、受け取った設定やビルドフックを利用しない。`--no-bundle` でコンパイル済み成果物を扱い、Workerは公開routeなし・workers.dev/Preview URL無効、Pagesはdevelopだけを対象にする。
7. APIで必須CI全体・`verify` / `Automation control checks` の成功、現在のdevelop、PRのHead/Base・担当ラベルを確認する。Worker公開の直前とPages公開に進む前にも再確認し、変更されていれば停止する。
8. 公開後のHTTP・SHA・デスクトップ/モバイル回帰テストは、Cloudflare公開トークンを持たない別ランナーの `regression` ジョブで行う。自動PRのマージはその成功後だけ許可する。

## 同じSHAの意味

- develop：pushされた実コミットSHAでCI・ビルド・成果物・公開・公開後の照合を統一する。
- 自動PR：GitHubのCI実行情報にあるHead SHAと、実際にテストした合成マージSHAを区別する。Headの最新のWeb checks成功と、成果物名/manifestの合成マージSHA・treeの一致を両方確認する。PRのマージ候補は期待するBase/Headを親に持つ必要がある。
- マージ後は実マージSHAの新しいCIと成果物を用いる。PR候補の成果物を別SHAの本番物として流用しない。

CI未完了は最大10分だけ待つ。最新の同SHA実行が失敗・中断・必須チェック欠落なら停止する。CIの一部だけを再実行して新attemptに該当成果物がない場合も停止し、Web checks全体を再実行して揃える。

## 公開を伴わない確認

`Develop staging deployment` をdevelopから運営者が手動実行し、`dry_run=true` を指定する。成功した同SHAのWeb checksと成果物が必要。Cloudflareトークンをステップへ渡さず、Workerの `wrangler deploy --dry-run` だけを行う。Pages公開と公開後の回帰テストは実行しない。

ローカルでは既存の自動化テストで、CI失敗/スキップ/別run、SHAやtreeの不一致、ファイル改変、秘密ファイル・リンク、develop/PR更新、途中停止を確認する。ローカルのパッケージとCLIのdry-runだけでは、GitHubのCI照合や実公開の成功まで証明しない。GitHub上のdry-runは実際のCI証跡と成果物取得も確認する。

## 制約と次の段階

- Worker成功後にPagesが失敗する部分公開は引き続きあり得る。実行全体を無条件に再試行せず、到達状況と実SHAを調べて復旧を判断する。復旧手順・訓練は次の改善対象。
- 公開中のdevelop更新をAPIで検出するが、GitHubとCloudflareをまたぐ原子的な公開トランザクションではない。共有検証環境のconcurrencyを維持する。
- 本番用テンプレート内の公開処理は今回変更していない。本番有効化前に、同様の分離と本番承認・移行・復旧の確認を別途行う。
- GitHub Appの権限や新規Secretの追加は不要。CI証跡の取得には、該当workflowの読取専用 `actions: read` を使う。

参照：[GitHubの成果物共有](https://docs.github.com/en/actions/tutorials/store-and-share-data)、[GitHub Actionsの安全な利用](https://docs.github.com/en/actions/reference/security/secure-use)。
