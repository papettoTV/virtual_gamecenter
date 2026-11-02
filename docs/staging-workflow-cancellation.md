# 古いstaging承認待ちの自動キャンセル

新しいdevelopの初回 `Web checks` が開始・完了すると、既存の起動workflowが公開前の古い承認待ちを整理する。CI成功時だけ、現在のdevelopに一致する実行をci-controlへ渡す。古いCIが後から成功しても、新しい公開待ちは作らない。

通常のアプリ変更に伴って古くなった承認待ちは、人がCancel workflowを押す必要がない。最新SHAへのstaging承認は従来どおり人が1回行う。本番の起動・承認・公開経路は変更しない。

## 自動キャンセルの条件

`ci/stale-staging-runs.mjs` は、次の条件をすべて確認したrunだけを対象にする。

- 同じリポジトリの `postmerge-staging.yml`、ci-controlブランチ、初回workflow_dispatch実行。
- prepareが成功し、stagingジョブが人の承認待ちで、runner・stepがまだ始まっていない。承認者はpapettoTV、環境はstagingだけ。
- そのrunから発行された小さな承認成果物に、run ID・制御SHA・対象アプリSHA・初回成功CI・manifestの識別子がそろっている。ZIPはメモリ内で1つのJSONだけ読み、展開先へファイルを作らない。
- 対象アプリSHAが最新developの厳密な祖先。同じSHAの重複実行は対象外。
- 固定制御SHAが現在のci-controlと一致する。旧制御版の場合は現在版の祖先であり、公開前に読み込む固定ガードとworkflowのGit blobがすべて同じである。

cancel直前にrun・job・承認待ち・成果物・develop/ci-controlを読み直す。別workflow・main・production・公開開始済み・再実行・期限切れ/不完全な証跡・分岐・未知のガードは触らない。取消API以外の書込、force-cancel、承認API、Cloudflare API、Secret取得は実装していない。

GitHubの状態読取とcancel要求は原子的ではない。確認後に人が承認しても、古いSHAを公開前に拒否する固定ガードを照合してから取り消す。developの既存force-push禁止も維持する。現在SHAの重複待ちを自動取消しないのは、その場合にはこの古いSHA拒否を使えないためである。

## 権限・結果

既存の起動workflowの `contents: read / actions: write` と一時GITHUB_TOKENを使用する。手元PATはActions read-onlyのまま。新規App・鍵・Secret・Environment・変数、ci-controlの更新やbypassは不要。

各起動のActions成果物 `stale-staging-cleanup-<run>-<attempt>` とstep summaryに安全な結果を残す。成果物の保存期間は7日。

|結果|意味|
|---|---|
|cancelled|取消APIの202と実際のcancelled状態を確認|
|cancel-requested|202受理済み。終了状態はまだ未確認|
|cancel-outcome-unknown|取消要求の通信結果が不明。自動再試行しない|
|untouched|条件不一致または証跡未確認で変更なし|
|would-cancel|読み取り診断での候補。書込なし|

整理で障害が起きても、条件を満たす現在SHAの公開起動は別に扱う。整理失敗はworkflowの失敗と成果物で通知し、黙って成功扱いにしない。新しい公開もstaging承認まで進まない。

## 公開しない検証

Node 22で `node --test ci/tests/stale-staging-runs.test.mjs ci/tests/postmerge-dispatch-registration.test.mjs`、続いてCI全テストとworkflow検査を行う。

既存の読取認証と人が確認した制御SHAで、次のコマンドを実行できる。`--apply`を付けなければ取消APIは呼ばない。資格情報・元応答・署名付きURLは出力しない。

```sh
EXPECTED_CONTROL_SHA=<現在の固定制御SHA> node ci/stale-staging-runs.mjs
```

実API診断で候補0件だったことは、実キャンセルの成功を意味しない。実証は設定だけの後続コミットで古くなった承認待ちを対象にし、Cancel成功と公開が始まらなかったことをIssueへ記録する。試験のためにstagingを承認・再公開する必要はない。

参照：[GitHubの取消API](https://docs.github.com/en/rest/actions/workflow-runs#cancel-a-workflow-run)、[workflow_runイベント](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)。
