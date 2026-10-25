# 単純なマージ後検証への切り替え準備

## 採用した流れ

Issue/手元実装 → PRのCI・Codexレビュー → developへマージ → 実SHAのpush CI・成果物 → 人がstaging承認1回 → 検証公開1回 → 回帰1回。失敗したら結果を記録して停止し、修正PRで対応する。候補公開、マージ後の再公開、回帰の再実行、自動巻き戻しは行わない。

本番は別の人の承認を維持する。main反映・本番公開・X投稿は今回行わない。本番後の短い確認と告知文提示は本番接続時に整理する。

## 今回の準備

- 旧候補方式の起動を停止定義に変更し、旧候補公開の承認ループを準備コードから削除した。以前のGitコミットとActions実行履歴は残す。
- PR前段のpremerge-decisionは同じPR・CI・Codexレビューと固定された定義を確認し、develop merge要求のデータだけを作る。develop-mergeは前段専用の明示transportで同じheadのsquashだけを要求する。どちらも現時点では実鍵・active workflowへ未接続。
- postmerge-stagingはPR番号を受け取らず、developの最新初回push CI runだけを使う。同じSHAのCI・固定定義・実コミットtree・成果物を照合し、staging承認前に固定、承認後に再照合する。手元PR・自動PRどちらのマージ結果も扱える。
- runPostmergeStagingは公開1回・回帰1回だけを直列に呼ぶ。途中でdevelopや成果物が変わる場合も最新へ切り替えず停止する。公開途中の処理は強制中断せず、待機中の古いSHAは起動時の照合で拒否する。
- postmerge-runnerの現在の副作用は模擬のみ。実CI成果物の照合と保護設定の読取は行うが、実公開・実回帰・実マージは行わない。
- 起動元はdevelopへのWeb checks成功をきっかけにci-controlをdispatchする。定義はdisabledで準備し、人による制御配置と固定SHAの更新前には有効化しない。起動側は共通ロックを保持せず、制御側だけで保持する。

## 実処理の鍵なし準備

staging-publicationは既存stagingだけの固定Worker/D1/R2/DO設定とゲートウェイで公開命令を組み立てる。staging-regressionは検証URLと両SHA、desktop/mobileの8件を必須とする。ブラウザへCloudflare/GitHub/OpenAI鍵を継承しない。これらのlive transportはまだ接続しない。

Wrangler4.114.0とPlaywright1.61.1の専用toolchain lockを用意し、鍵を扱う処理から依存取得を分離する。実成果物でのWrangler dry-runはパッケージング確認であり、実環境の回帰合格ではない。

## 次の操作

1. 通常CI後にdevelopの登録定義と旧候補起動停止を反映する。
2. 人が管理するAppの一時例外・既存鍵で、鍵なしの新しいci-controlパッケージを配置し、例外を削除する。
3. stagingの保護設定版と固定control SHAを更新する。
4. developの成功CIから新経路を自動起動し、staging承認1回で実証跡を再照合して模擬公開1回・模擬回帰1回を確認する。
5. その後にPR自動マージと実公開・実回帰の鍵/transportを接続する。未検証の鍵を先に置かない。

## 現在の限界

新しいci-controlの配置は人の操作待ち。現行ci-controlの旧予行コードを新経路の成功と扱わない。実自動マージ・実公開・実回帰は未接続。本番workflowは無効テンプレートのまま、production有効フラグもfalseを維持する。
