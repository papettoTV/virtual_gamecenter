# 開発・公開ブランチ

- 通常の開発先は `develop`。変更単位でテストを確認し、コミットする。
- pushする場合は原則 `develop`。`main` は `pulbase.com` の本番公開用であり、mainへのマージ・pushはユーザーの明示的な指示がある場合だけ行う。
- 検証サイトは既存の `virtual-gamecenter.pages.dev` を維持する。本番は既存の検証環境とは別リソースで新設する。
- Cloudflare上の変更・デプロイは、ローカルの準備やGitのpushと分けて扱う。実施していない作業を完了扱いにしない。
- 公開準備の詳細は `docs/production-environments.md` と `docs/production-launch-checklist.md` を参照する。
