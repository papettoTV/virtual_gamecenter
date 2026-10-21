# 開発・公開ブランチ

- 通常の開発先は `develop`。変更単位でテストを確認し、コミットする。
- pushする場合は原則 `develop`。`main` は `pulbase.com` の本番公開用であり、mainへのマージ・pushはユーザーの明示的な指示がある場合だけ行う。
- 検証は `develop.virtual-gamecenter.pages.dev` / `develop`。Pages本番は `virtual-gamecenter.pages.dev` / `main` で、`pulbase.com` はそのカスタムドメイン。PagesのProduction branchをdevelopへ変更しない。バックエンド・DB等は環境別に分離する。
- Cloudflare上の変更・デプロイは、ローカルの準備やGitのpushと分けて扱う。実施していない作業を完了扱いにしない。
- 公開準備の詳細は `docs/production-environments.md` と `docs/production-launch-checklist.md` を参照する。

# GitHub Issue・PRの言語

- 作成するGitHub IssueとPull Requestのタイトル・本文は日本語で記述する。自動化が作成するものも同様とする。
- コード、API名、ファイルパス等の固有の識別子は原文のままでよい。


# Issueの実装担当とPRの重複防止

- `実装:自動` ラベル付きIssueはGitHub Actions上のCodexが担当する。手元のCodexは同じIssueの実装や別PR作成を開始しない。起票・ラベル付与・実行監視・失敗調査にとどめる。
- `実装:自動` がないIssueは手元実装とする。`実装:手元` は任意の明示ラベル。両ラベルの併用は禁止し、勝手に担当を切り替えない。旧 `codex:run` ラベルやActionsの手動実行では自動実装の明示を代用できない。
- Issueの実装開始前と新規PR作成直前に、最新developの `node ci/check-manual-issue.mjs <Issue番号>` で現在の担当・既存PRを確認する。失敗したら新しい実装/PRを開始しない。既存PRがあればそのPRを確認し、続きを扱う。
- 手元実装のブランチは `manual/issue-<番号>` を使い、PR本文に `Closes #<番号>` を記載する。自動実装用 `codex/issue-<番号>` は手元から使わない。関連するだけの別PRでは `Refs #<番号>` を使い、実装担当と区別する。
- 自動から手元への引継ぎを指示された場合は、`実装:自動` を外して `実装:手元` を付け、該当IssueのActions実行を停止・完了確認し、既存PR/ブランチを確認してから作業する。ラベル変更だけでは実行中プロセスが即時停止したとは扱わない。
- 手元PRは既存の必須CIとマージ判断を維持する。自動PRは既存の独立レビュー・検証公開・自動マージを維持する。どちらもdevelopへのマージ後は既存の検証公開・SHA/HTTP/ブラウザ確認を利用し、main/本番の公開判断とは分離する。
