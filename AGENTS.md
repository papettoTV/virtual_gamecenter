# 開発・公開ブランチ

- 通常の開発先は `develop`。変更単位でテストを確認し、コミットする。
- pushする場合は原則 `develop`。`main` は `pulbase.com` の本番公開用であり、mainへのマージ・pushはユーザーの明示的な指示がある場合だけ行う。
- 検証は `develop.virtual-gamecenter.pages.dev` / `develop`。Pages本番は `virtual-gamecenter.pages.dev` / `main` で、`pulbase.com` はそのカスタムドメイン。PagesのProduction branchをdevelopへ変更しない。バックエンド・DB等は環境別に分離する。
- Cloudflare上の変更・デプロイは、ローカルの準備やGitのpushと分けて扱う。実施していない作業を完了扱いにしない。
- 公開準備の詳細は `docs/production-environments.md` と `docs/production-launch-checklist.md` を参照する。

# GitHub Issue・PRの言語

- 作成するGitHub IssueとPull Requestのタイトル・本文は日本語で記述する。自動化が作成するものも同様とする。
- コード、API名、ファイルパス等の固有の識別子は原文のままでよい。
