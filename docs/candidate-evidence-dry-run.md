# 実PR・CI・Codexレビューの公開なし検証

この段階は読取専用の検証であり、公開の認可や本番運用の開始ではない。ci-controlの予行試験は承認1回で成功済みだが、今回の実証跡処理はまずdevelopの鍵なしworkflowで検証する。ci-controlへの実処理の配置・公開鍵の登録・自動dispatchは別の管理手順とする。

## 試験対象

`実装:自動` と `検証:公開なし` の両ラベルがある小さな文書Issueを使う。実装担当はActionsのCodexだけとし、手元から同じIssueのPRを作らない。PRは未マージで維持する。

Codex PR verificationのgateでIssueラベルから公開なしモードを固定し、stagingとその後続の回帰・マージをスキップする。レビュー合格ジョブが候補head/base/merge SHA/tree、ビルドrun/attempt/artifact ID、レビューrun/attemptを記録する。レビューに失敗した場合は合格証跡を保存しない。

レビューworkflow完了イベントから「候補の実証跡検証（公開なし）」を自動起動する。Contents/Actionsはreadのみ、EnvironmentとSecret参照はなく、候補コードをcheckout・実行せず、固定時点のdevelopコードで成果物をデータとして検査する。公開API・マージAPI・dispatch APIは呼び出さない。旧公開workflowの切替や権限増加も含まない。

## 照合・停止条件

- 同一repoのopenな自動PR、現在のdevelop、head/base/merge SHA、マージ候補の親2件とtreeを照合する。
- 同じheadの最新Web checksとCodex PR verification、必須ジョブ合格、初回attempt、レビュー合格と空の指摘を確認する。
- runに紐付いた期限内の単一artifact、そのmanifest、全ファイルのSHA-256、ファイル集合、Worker/PagesのSHA刻印を検査する。候補の設定ファイル・依存・コマンドは実行しない。
- ダウンロード後にもPRとCIを再取得する。head/base/候補の変更、run差替え、不合格レビュー、attempt2の入力を与えて拒否を確認する。これは実データを基に入力を変えた負の試験であり、実PRを書き換えたりGitHubのRe-runを実行する試験ではない。
- workflow自身もdevelopのworkflow_run初回以外を拒否する。一覧が100件以上や総数不一致なら不完全として停止する。

証跡の`realMergeExecuted:false`と`realDeploymentExecuted:false`を確認する。検証用ラベルを外して公開へ進める運用は行わず、試験後は人の指示に沿ってIssue/PRを終了する。

## 限界

develop上のコードとレビューworkflow自体は開発権限で変更できる。今回の成功を、そのまま公開鍵を渡す根拠にしてはならない。実公開前に、レビュー定義の信頼基準・固定制御コードへの移設・人の承認対象の固定・旧公開経路停止を確認する必要がある。main反映・本番公開・X投稿は行わない。
