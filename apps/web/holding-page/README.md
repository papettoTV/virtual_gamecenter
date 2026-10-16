# 本番公開の一時停止

2026-10-16、ユーザー指示により本番Pages（virtual-gamecenter / main、pulbase.com）へこの一時ページをDirect Uploadする。developのアプリ・バックエンドは変更しない。

- 全画面URLに「現在準備中」を表示し、旧ゲームURLもアプリへ接続しない。
- `/api/`、WebSocket、GET/HEAD以外は503。Service Bindingへ転送しない。
- no-store / noindex。解析タグ・外部リソースなし。
- アプリのdist/clientやPagesゲートウェイとは別の成果物として扱う。

本番のProduction branchはmainを維持。Gitのmainへは変更をpushしていない。今後mainへpushまたは本番を再デプロイすると、この一時ページが置き換わる可能性がある。サービス公開の明示指示があるまでアプリ本体を本番へデプロイしない。
