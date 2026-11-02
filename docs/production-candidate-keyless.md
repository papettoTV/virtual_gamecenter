# 本番候補の鍵なし照合

## 目的と現在の境界

developのCI、承認済み検証公開の実結果、同じSHAの本番ビルドを結合する候補検査。2026-10-29に人の管理操作で保護されたci-controlの`7dd7b4c`へ追加配置し、既存制御保持・追加ファイル・bypass空をAPI確認した。配置内容と復帰手順は[配置記録](install-production-inspection.md)を参照する。成功結果も人による本番承認・公開許可として使わない。実行可能な本番公開workflow・GitHub書込API・Cloudflare通信・X投稿・公開用の鍵は接続していない。

旧production-releaseテンプレートは引き続き無効。production Environmentのmain限定・人の承認必須、main/ci-controlのbypass空、本番フラグfalseを維持する。候補検査のためにproductionをdevelopへ開放しない。

## 照合する証跡

1. 設定監査で準備中のフラグ・保護・Secret名の保管先を確認する。
2. 現在のdevelopに対する初回成功のWeb checks・必須ジョブ・固定された25ファイル・staging成果物を既存の固定検証器で照合する。
3. `policy.json`で指定した制御SHAの`postmerge-staging.yml`がci-controlから初回実行され、prepare/stagingが成功していることを確認する。
4. そのrunのapproval/result ZIPをArtifact IDでGETし、GitHubのdigestと実ZIPのSHA-256・サイズを照合する。ZIPは展開せず、許可したJSON1件だけを読む。パス逸脱・リンク・余計なファイル・暗号化・過大な入力は拒否する。
5. approvalの実行ID・CI・SHA・tree・manifest digest・ファイル数とresultを結合する。strict、人のstaging承認1回、実公開1回、実HTTP/ブラウザ8件の回帰1回が成功したものだけを使う。鍵なし模擬・construction・部分結果は拒否する。
6. 同じdevelop SHAの最新・初回成功したproduction-preparation（pushまたはworkflow_dispatch）と、固定した準備コード6ファイルのblobを照合する。PRのマージ候補ビルドは採用しない。ローカル移行・本番ビルド・Worker dry-run・ブラウザ定義読込と、実公開なしの結果を確認する。
7. mainからfast-forward可能であること、読取中にdevelop/main/制御SHA・CI・run attemptが変わっていないことを再照合する。CI・検証runの作成から24時間までを対象とする。

Artifactのdigest仕様：[GitHub公式API](https://docs.github.com/en/rest/actions/artifacts)。digest一致だけで信用せず、固定workflow/SHA・run・ジョブ・artifactの出所も照合する。

## 実行方法

既存の開発用GitHub CLI認証を使い、リポジトリ固定のGETだけを行う。任意URL・任意workflow・鍵を入力するオプションはない。

```bash
node ci/production-candidate/check.mjs <検証公開run-ID> <同じSHAの本番準備run-ID>
```

成功時の出力は`ci/results/production-candidate.json`。失敗時は以前の成功ファイルを残さず終了する。`evidencePassed=true`でも`productionReady/humanApprovalVerified/controlInstalled/mainUpdated/workerCreated/deploymentRequested/xPosted`はfalseのまま。fingerprintは同じ候補を照合するためのハッシュであり、署名や人の承認ではない。有効期限は候補検査から1時間。設定監査は前後に行うが、将来の状態を保証しない。

production-preparationは対象ファイルを変更したdevelopへのpushでも自動実行する。鍵・EnvironmentなしでSQLのメモリ内適用・ビルド・dry-run・定義読込だけを行う。対象外ファイルだけの更新では手動実行が必要になることがある。新しい検証公開をこの検査から起動・承認することはない。

## 模擬リリース

`simulateProductionRelease`はテスト用のデータだけを受け取る。実行コマンド・ネットワーク関数・liveモードはない。模擬承認1回→main昇格1回→公開1回→回帰1回の順序を想定し、候補の変更・期限切れ・承認なし・回帰失敗を拒否する。カウントはすべて模擬で、実際のmain更新・公開・回帰は0回。失敗時に自動再試行・巻き戻し・成功告知へ進まない。

## 実証できたことと残ること

- 正常系・古い候補・再実行・他repo・別制御SHA・CI失敗・模擬回帰・証跡改変・ZIPの危険入力・模擬承認後の差し替えをローカルとCIでテストする。
- 既存run 40494784321のapproval/resultの実ZIP2件で、digest/サイズ照合とJSON読取に成功した。これは以前のSHA 4368ea5の記録であり、現在のdevelopの本番候補成功には流用しない。
- 現在のdevelopについての実証跡一式の合格は未確認。古いrunは鮮度/現在SHAの条件で拒否する。新しい検証公開・HTTP/ブラウザ回帰を今回勝手に起動しない。
- CLIへ古い検証run 40494784321を指定した実GETでも、鮮度条件で終了コード1となり、成功JSONを生成しないことを確認した。これは拒否条件の実証であり、現在候補の合格ではない。
- 検査コードの固定制御への配置は完了。Environmentの許可元とmain昇格権限の設計、初回Worker/D1/Secret/Pages準備、実公開用成果物の固定・ハッシュ照合、本番回帰・復旧・成功後の告知文提示への接続は残る。
- 実公開用の処理と権限を接続する前に人が保護されたコードを配置し、承認前後の同一候補・成果物・設定の再照合を実行する必要がある。今回の候補JSONや模擬承認のbooleanをその代わりにしない。

Worker作成・デプロイ、本番DB書込、main反映、本番公開、X投稿の指示としてこの資料を扱わない。
