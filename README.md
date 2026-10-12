# virtual_gamecenter

オンライン上にゲームセンター体験を作るための試作リポジトリです。

複数のゲームと、観戦・ランキング・アカウント・クレジット購入などの共通機能を開発しています。

## Structure

- `apps/web/`: WebアプリケーションとCloudflareバックエンド
- `docs/`: サービス要件・設計資料

## Development Workflow

基本方針は、ローカルで開発・確認し、まとまったタイミングでCloudflareへデプロイします。

通常の開発・push先は `develop`（検証：`virtual-gamecenter.pages.dev`）。`main` は本番 `pulbase.com` 用です。mainへのマージ・pushはリリース指示があるときだけ行います。Pagesから現行Workerへの接続は準備中です。

```bash
cd apps/web
npm install
npm run dev
```

ローカルサーバ起動後、表示された `Local` または `Network` のURLをブラウザで開きます。
スマホで確認する場合は、PCとスマホを同じWi-Fiにつなぎ、`Network` のURLをスマホで開きます。

ローカル開発中はBasic認証を無効化しています。
Cloudflareの限定公開先ではBasic認証を維持します。本番・検証環境の準備と公開判定は [`docs/production-environments.md`](docs/production-environments.md) を参照してください。

公開前のビルド確認:

```bash
npm run build
npm run preview
```

Cloudflareへ反映:

```bash
npm run release:check -- staging
npm run deploy -- staging
```

## Deployment

- 現行構成は静的画面・API・観戦通信を1つのCloudflare Workerへ統合しています。
- 本番URL：`https://pulbase.com/`（main、新設準備中）。検証URL：`https://virtual-gamecenter.pages.dev/`（develop、既存を維持しWorker接続を準備）。GitのpushだけでAPI/観戦の動作まで確認済みとは扱いません。
- 環境未指定のデプロイ・リモート移行は拒否します。準備中の仮D1 IDも公開用に使用できません。

## License

このリポジトリのソースコードは MIT License で公開します。

詳しくは `LICENSE` を参照してください。

## Contributions

Pull Request を送ることで、その貢献物を MIT License の下で提供することに同意したものとします。

詳しくは `CONTRIBUTING.md` を参照してください。

## Assets

画像、音楽、効果音、フォント、ロゴ、キャラクター等の素材は、コードとは別に権利管理します。

詳しくは `ASSETS_LICENSE.md` を参照してください。
