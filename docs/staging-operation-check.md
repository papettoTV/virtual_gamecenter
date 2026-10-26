# staging公開の運用確認

## 構築モードで確認できたこと

[実行40416057806](https://github.com/papettoTV/virtual_gamecenter/actions/runs/40416057806)は、developの実マージSHA `0d74ccb5588a16359783dc1d8d3a23e17b9954a9`、制御SHA `2c883a1cdd961510a0557742f74294739752f445` で成功した。

- 同じSHAの初回push CI `40415790921` が成功し、公開処理が自動起動した。
- 成果物114ファイルを照合し、人のstaging承認1回で実行した。
- WorkerとPages developへ公開し、HTTPで両方のSHAが一致した。
- 実ブラウザ回帰8件が合格し、公開1回・回帰1回で完了した。
- mainは `73cb5d9267c56f06f9f1150327ec6b8b3caa2bb9` のまま。本番公開・X投稿は実施していない。

これはconstructionでの成功記録であり、strictでの最終試験とは区別する。

## 本運用条件の最終確認

1. 人がci-controlのbypassを空にし、Active・対象ci-controlだけ・作成/更新/削除/force push禁止4件を維持する。
2. 削除後の更新日時とmainの保護設定版を確認し、人がstaging Environmentの `PULBASE_CONTROL_RULE_VERSIONS` を `protectionMode=strict` で登録する。古い設定版は流用しない。
3. Repositoryの固定制御SHA、stagingの許可ブランチci-controlのみ・papettoTV承認必須・管理者bypass禁止を確認する。公開鍵とBasic認証はstagingに保管し、値を取得・表示しない。
4. 文書だけの変更をdevelopへ取り込み、同じ新しいSHAの初回push CI成功から自動起動させる。古い実行の再実行や手動の公開コマンドは使わない。
5. 承認前の公開対象SHA・CI・成果物照合を確認し、人がstaging承認を1回行う。
6. 結果JSONの `status=passed`、`protectionMode=strict`、`approvalCount=1`、`publicationCount=1`、`regressionCount=1`、Worker/Pagesのuploaded、実HTTP/ブラウザ回帰成功を確認する。bypassが空でmainが据え置きであることも再確認する。

公開先は `pulbase-staging` と `https://develop.virtual-gamecenter.pages.dev` だけ。回帰試験では検証用ゲストを作成する。失敗時は停止して修正PRで対応し、自動再公開・巻き戻しはしない。

旧公開・旧自動マージ・production・Xのフラグはfalseを維持する。この試験の成功だけでIssueからの自動マージ再開や本番リリース準備全体の完了とは扱わない。mainへの反映・本番公開には別途人の明示的な指示が必要。
