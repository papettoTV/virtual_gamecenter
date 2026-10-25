# staging実処理の鍵なし準備

## 実装と確認済みの範囲

PR #45で旧公開・マージ経路を停止し、レビュー生成元の固定を準備した。旧Repository variables PULBASE_STAGING_DEPLOY_ENABLEDとPULBASE_AUTO_MERGE_ENABLEDは人がfalseへ変更し、APIでも確認した。mainは変更していない。

新しいprotected候補検証は、review-trust.jsonの固定定義をbase/head/候補のGit treeと照合し、runのPR snapshot・初回・24時間以内を確認する。承認前のpacketと承認後の再照合に同じpolicy digestを結び付ける。保護ブランチへ配置するまで現行ci-controlの動作は変わらない。

## 実処理の準備

- staging-publication.mjs：既存stagingの固定Worker/D1/R2/DO設定と固定Pagesゲートウェイを使う。成果物の生成設定やnpm scriptsは採用しない。WorkerとPagesの各書込前に成果物と対象を再検証し、途中の候補変更は停止する。Pagesのmain/preview自動公開停止を確認し、設定の変化は自動PATCH/巻き戻しをせず停止する。
- staging-regression.mjs：検証URLへのHTTPとWorker/Pages両SHAを照合し、固定のdesktop/mobileテスト8件を必須にする。ブラウザにはBasic認証だけを渡し、Cloudflare/GitHub/OpenAIの鍵を継承しない。実行すると検証用ゲストを作成する既存テストを利用する。
- staging-merge.mjs：developのstrictな必須チェックと発行元を確認し、同じheadを指定したsquash mergeだけを要求する。timeoutは不明、マージ後照合失敗は既知SHAを記録して止める。実マージSHA自身の初回push CI・成果物と親/treeを確認する。候補CIでは代用しない。
- 実処理に既定のネットワーク/コマンドtransportはなく、active workflowから呼ばない。今回のテストでは明示した試験transportを使う。実鍵の接続・実回帰・実マージは別の手順。

Wranglerは現行lockと同じ4.114.0、Playwrightは1.61.1の専用toolchain lockを準備する。依存インストール・ブラウザ取得は鍵を扱う処理から分離し、ignore-scriptsで行う設計で、現時点ではactive workflowへ導入しない。

## 鍵なしの実測

PR #44の実CI成果物114ファイルを取得し、全ハッシュ・刻印を検証した。固定staging設定を生成し、認証envを継承しないWrangler deploy --dry-run --no-bundle --autoconfig=falseでパッケージングに成功した。Worker/Pagesのアップロードはなく、実サービスの動作確認成功とは扱わない。

## 次の管理操作

1. 新しい信頼定義を含む制御コードをレビューし、鍵なしの更新ZIPを準備する。
2. 自動起動を一時停止してから、人が管理するrelease Appの一時例外と鍵でci-controlを更新し、例外を削除する。
3. stagingの保護設定版、固定control SHAを人が更新し、自動起動を戻す。
4. 新しい公開なし試験Issueで、固定レビュー定義の照合とstaging承認1回を再検証する。
5. 合格後に初めて、公開用の最小権限鍵・マージ鍵の配置とlive transportの接続を検討する。

## 未完了・限界

実公開の接続、ブラウザの実環境回帰、新しい経路での実マージ・実SHA再公開は未検証。Pages Writeは同じプロジェクトの本番も書けるため、鍵は人の承認後の固定制御コードだけへ渡す。今回の成功を鍵のアクセス分離完了とみなさない。main反映・本番公開・X投稿は行わない。

参考：
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/pages/configuration/preview-deployments/
