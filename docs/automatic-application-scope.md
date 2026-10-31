# 自動実装のアプリコード範囲

Issue #94で、自動実装を検証向けアプリコード全般へ拡大する。Issue #91は自動担当を維持し、この設定の配置後に再開する。

## 許可する範囲

`ci/policy.mjs` の拡張子と通常ファイル検査を満たす次のパスを許可する。

- `apps/web/src/`：UI、ゲーム、Game SDK、認証・同意・クレジット・決済のクライアント、Worker/backend。`src/pages/` は除外。
- `apps/web/tests/`：単体・統合・ブラウザ検査とテキストfixture。
- `apps/web/public/`：JavaScript、CSS、JSON、HTML、SVG、テキスト。Pages制御ファイルとバイナリは除外。
- `apps/web/index.html` と `docs/*.md`（下位ディレクトリを含む）。

`platform`、`credit`、`auth`等の文字列だけで拒否せず、ゲームJavaScriptもrendering限定にしない。保護対象を別パスへ移す迂回は禁止する。

## 保護を維持する範囲

CI/CD、ci-control、公開先・gateway、環境設定、依存関係、DB移行、Secret管理、エージェント指示は自動編集しない。`*.config.*`、`.agents` / `.codex` / `.github`、指示ファイル名、Pagesの `_worker.js` / `_routes.json` / `_redirects` / `_headers` は拒否する。renameの元パスも同じ検査を行い、リンク・実行ファイル・バイナリ差分の拒否も維持する。

アプリ内の認可・会計検証を緩めてよいという意味ではない。独立レビューは不具合、認可迂回、重複消費、安全テストの弱体化を拒否する。実装・テストはダミー認証と使い捨てのローカルDBを使用し、本番サービス・通常利用者の残高は使わない。

## 配置と運用

実装指示、独立レビュー指示、編集ポリシーを同時に更新し、32件の固定信頼定義と本番準備用policy digestを揃える。ci-controlには人の管理鍵で信頼定義3ファイルだけを配置し、その他31件は保持する。公開workflowや公開先は変更しない。

通常運用は strict・bypass空、staging承認1回、developマージ後の公開1回・回帰1回。main反映・本番公開・X投稿は今回行わない。配置に必要な一時例外の追加・削除と固定値更新は、人による管理操作として順に確認する。配置未完了の間は#91を再開しない。

## 配置記録

人用ツールでci-controlを `ddc92cdf2193a68674a1c8ec2451c7ca71990ff4` へ更新した。親は `1919c95b933d9b820b6db7bc54572020923c9849`。信頼定義3ファイルの一致と残り31件の保持を確認した。一時例外削除後のUTC設定版は `2026-10-31T04:40:37.870Z`、bypassは空。Repositoryの固定SHAとstagingのstrict設定版の更新、developへの反映、#91再開はこの配置とは別に確認する。
