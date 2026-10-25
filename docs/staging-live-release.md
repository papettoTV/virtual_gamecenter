# staging実公開・回帰への接続

## 公開の流れ

developへマージ → 同じ実SHAの初回push CIと成果物が成功 → ci-controlから自動起動 → 公開対象SHA・CI・成果物ハッシュの固定 → 人がstaging承認1回 → 同じSHAのWorkerとPages developへ公開1回 → HTTPとdesktop/mobileのブラウザ8件を回帰1回 → 結果JSONを保存。

公開先は既存のpulbase-stagingとhttps://develop.virtual-gamecenter.pages.devだけ。main・本番・Xは対象外。失敗時は停止して修正PRで対応し、自動再試行・再公開・巻き戻しはしない。WorkerとPagesの間の失敗は部分反映になり得るため、Worker/Pagesの結果をnot-attempted / unknown / uploadedとして残す。unknownは失敗確定ではなく、再実行せず確認する。

## 固定された制御と鍵

公開命令・Worker/D1/R2/DO設定・Pages develop指定・ブラウザ定義・依存lockはci-control側に固定する。prepareは読取のみで、承認後にも保護設定版・現在のdevelop・同じCI・成果物を各処理の前に再照合する。旧鍵なしpacketはversion 3の実公開packetへ流用できない。

staging承認後、固定lockからinstall scriptsなしでツールを取得し、ChromiumとOS依存を取得する。その後の公開・回帰stepだけにstagingのCLOUDFLARE_API_TOKEN、PULBASE_CHECK_USERNAME、PULBASE_CHECK_PASSWORDを渡す。Cloudflareトークンは公開用子プロセスだけ、Basicは検証originのHTTP/ブラウザだけに渡す。子プロセスにGitHub/OpenAI鍵は継承しない。外部HTTP/WS・Service Worker・trace/videoを無効にし、生のCLI出力やブラウザJSONは成果物に含めない。回帰は検証用ゲストを作成するが、Googleログイン・本番・決済には進まない。

Cloudflareトークンは対象アカウント1件、Individual Workersのpulbase-stagingにEditor、Pages Writeを必要範囲で付与する。既存Workerのbindingsだけのデプロイには、D1/R2への独立した直接操作権限は追加しない。Pagesと本番が同じプロジェクトのため、Pages鍵自体でブランチ単位の分離はできない。人のstaging承認と変更不能の制御コードでdevelopだけへの使用を制限する。鍵は管理用端末で作成し、staging Environmentだけへ保管する。AIの手元・repository共通Secret・codex Environmentには保管しない。

## 最短の配置順序

1. 準備PRのCIを確認する。自動起動は停止せず、PRをdevelopへマージする前に次の準備を完了する。
2. 人がci-controlだけにpulbase-releaseの一時例外を追加し、確認済みの設定版に固定した更新ツールを管理用端末から実行する。配置ツールは制御コードの配置だけで、公開やworkflow起動をしない。成功・失敗にかかわらず一時例外を削除する。
3. 配置内容と保護設定を確認し、stagingの保護設定版とRepositoryの固定制御SHAを更新する。
4. 管理用端末で最小権限のCloudflareトークンを作り、stagingに登録する。既存BasicのSecret名を確認する。値はチャットへ貼らない。
5. 準備PRをdevelopへマージする。同じSHAのCI成功から新制御が自動起動する。承認前に公開対象と証跡を確認し、人がstaging承認1回を行う。
6. 公開結果・HTTP両SHA・ブラウザ8件・main据え置きを確認する。旧公開・旧自動マージとproductionフラグはfalseを維持する。

## 検証と現時点の範囲

準備段階ではダミー認証・差し替えた通信/プロセスで成功経路と部分反映・認証不足・HTTP/ブラウザ失敗時の停止を検証する。実成果物のWorker dry-runとブラウザ定義読込も鍵なしで確認する。これを実公開・実回帰の成功とは扱わない。実環境の確認は制御配置とSecret登録後、人のstaging承認を受けた実行で行う。

公式仕様: [Workersの役割とbindings](https://developers.cloudflare.com/workers/authorization/workers/)、[Pages API](https://developers.cloudflare.com/pages/configuration/api/)、[Playwright CI](https://playwright.dev/docs/ci-intro)。
