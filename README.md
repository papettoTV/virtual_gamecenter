# 単純なマージ後検証への切り替え準備

## 採用した流れ

Issue/手元実装 → PRのCI・Codexレビュー → developへマージ → 実SHAのpush CI・成果物 → 人がstaging承認1回 → 検証公開1回 → 回帰1回。失敗したら結果を記録して停止し、修正PRで対応する。候補公開、マージ後の再公開、回帰の再実行、自動巻き戻しは行わない。

本番は別の人の承認を維持する。main反映・本番公開・X投稿は今回行わない。本番後の短い確認と告知文提示は本番接続時に整理する。

## 今回の準備

- 旧候補方式の起動を停止定義に変更し、旧候補公開の承認ループを準備コードから削除した。以前のGitコミットとActions実行履歴は残す。
- PR前段のpremerge-decisionは同じPR・CI・Codexレビューと固定された定義を確認し、develop merge要求のデータだけを作る。develop-mergeは前段専用の明示transportで同じheadのsquashだけを要求する。どちらも現時点では実鍵・active workflowへ未接続。
- postmerge-stagingはPR番号を受け取らず、developの最新初回push CI runだけを使う。同じSHAのCI・固定定義・実コミットtree・成果物を照合し、staging承認前に固定、承認後に再照合する。手元PR・自動PRどちらのマージ結果も扱える。
- runPostmergeStagingは公開1回・回帰1回だけを直列に呼ぶ。途中でdevelopや成果物が変わる場合も最新へ切り替えず停止する。公開途中の処理は強制中断せず、待機中の古いSHAは起動時の照合で拒否する。
- postmerge-runnerは固定の公開・HTTP／ブラウザ処理に接続した。起動モードはコードにkeylessを固定し、入力・変数・Secretでliveに変更できない。承認対象のpacketはversion 2に更新し、旧packetを拒否する。
- 起動元はdevelopへのWeb checks成功をきっかけにci-controlをdispatchする。定義はdisabledで準備し、人による制御配置と固定SHAの更新前には有効化しない。起動側は共通ロックを保持せず、制御側だけで保持する。

## 実処理の鍵なし準備

staging-publicationは既存stagingだけの固定Worker/D1/R2/DO設定とゲートウェイで公開命令を組み立てる。staging-regressionは検証URLと両SHA、desktop/mobileの8件を必須とする。ブラウザへCloudflare/GitHub/OpenAI鍵を継承しない。接続factoryには将来のlive transportを用意するが、現在のrunner・workflowからは呼ばない。live transportのテストはダミー認証・差し替えた通信とプロセスだけで実施する。

Wrangler4.114.0とPlaywright1.61.1の専用toolchain lockを用意し、鍵を扱う処理から依存取得を分離する。鍵なし接続では、同じ公開関数からWorkerのdry-runを実行し、Pages書込とHTTP応答は模擬する。ブラウザ関数は固定Playwrightを`--list --reporter=json`で起動し、desktop/mobile合計8件を確認する。実環境の回帰合格とは扱わず、結果にはrealDeploymentExecuted=falseとrealRegressionExecuted=falseを残す。

各公開命令とHTTP／ブラウザ処理の直前に、保護設定・同じdevelopの証跡・承認範囲・manifestを再照合する。公開先と実行ファイルは制御コードで固定し、候補側の設定や任意shellは実行しない。CF鍵は公開プロセスだけ、Basicは検証URLへのHTTP／ブラウザだけに渡す。子プロセスへGitHub/OpenAI鍵は渡さない。Basicの送信originを固定し、ブラウザの外部HTTP/WSとService Workerを遮断する。JSONには認証設定が含まれ得るためメモリ内で検査し、安全な件数・判定だけを保存する。

## 次の操作

1. 管理用端末でPULBASE_CONTROL_EVIDENCE_ENABLED=falseにして更新中の自動起動を止める。旧公開・自動マージとproductionフラグはfalseを維持する。
2. 通常CI後に接続実装をdevelopへ反映する。mainは変更しない。
3. 人がci-controlだけにpulbase-releaseの一時例外を追加する。設定版を確認して配置ツールのapplyを固定した後、管理用端末の既存鍵で新しい鍵なしパッケージを配置し、成功・失敗にかかわらず例外を削除する。
4. 配置ファイルと一時例外削除を確認してから、stagingの保護設定版と固定control SHAを更新し、自動起動を再開する。
5. 最新developの初回成功CIから起動し、staging承認1回で鍵なし接続試験を確認する。実公開・実HTTP・ブラウザ回帰はまだ行わない。
6. その後にPR自動マージと実公開・実回帰の鍵を接続する。鍵の登録前に新しい制御コード・保護設定・承認経路を確認する。

## 現在の限界

接続版ci-controlの配置は人の操作待ち。現行ci-controlの旧予行コードを新経路の成功と扱わない。実自動マージ・実公開・実回帰は未接続。本番workflowは無効テンプレートのまま、production有効フラグもfalseを維持する。

## 実成果物を使った手元の鍵なし接続確認

develop `343faca930a07584fbb8374721c1c1fc1039a63d` のpush CI `40170175364`、成果物 `12589754261` を取得し、114ファイルのハッシュと刻印SHAを照合した。固定Wrangler 4.114.0のWorker dry-runと固定Playwright 1.61.1の8件読込が成功した。PagesとHTTPは模擬、実公開・実回帰・マージは0回。これは手元検証であり、GitHubで人がstaging承認した接続版の実行結果ではない。
