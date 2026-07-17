# virtual_gamecenter

オンライン上にゲームセンター体験を作るための試作リポジトリです。

現在は、弾幕かすり・無敵体当たり・ボス撃破型シューティングのプロトタイプを開発しています。

## Prototype

- `prototype-twinkle-psyvaria/`

## Development Workflow

基本方針は、ローカルで開発・確認し、まとまったタイミングでCloudflareへデプロイします。

```bash
cd prototype-twinkle-psyvaria
npm install
npm run dev
```

ローカルサーバ起動後、表示された `Local` または `Network` のURLをブラウザで開きます。
スマホで確認する場合は、PCとスマホを同じWi-Fiにつなぎ、`Network` のURLをスマホで開きます。

ローカル開発中はBasic認証を無効化しています。
Cloudflare Pages上ではBasic認証が有効です。

公開前のビルド確認:

```bash
npm run build
npm run preview
```

Cloudflareへ反映:

```bash
npm run deploy
```

## Deployment

- Game: https://virtual-gamecenter.pages.dev/
- Ranking API: https://graze-duel-ranking-api.aegfrompsbt.workers.dev/api/ranking

## License

このリポジトリのソースコードは MIT License で公開します。

詳しくは `LICENSE` を参照してください。

## Contributions

Pull Request を送ることで、その貢献物を MIT License の下で提供することに同意したものとします。

詳しくは `CONTRIBUTING.md` を参照してください。

## Assets

画像、音楽、効果音、フォント、ロゴ、キャラクター等の素材は、コードとは別に権利管理します。

詳しくは `ASSETS_LICENSE.md` を参照してください。
