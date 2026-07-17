# Ranking API Worker

Cloudflare Workers + D1 用のランキングAPIです。

## 使うCloudflareサービス

- **Cloudflare Workers**: ランキングAPIを動かすサーバー
- **Cloudflare D1**: ランキングを保存するSQLデータベース
- **Cloudflare Pages**: ゲームHTML/CSS/JSの公開先

## 初回セットアップ

Cloudflareを初めて使う場合は、先に以下が必要です。

1. Cloudflareアカウントを作成する
2. Node.jsをインストールする
3. WranglerでCloudflareにログインする

```bash
npx wrangler login
```

## ランキングAPIを作る手順

このディレクトリで作業します。

```bash
cd prototype-twinkle-psyvaria/worker
```

1. Wrangler設定ファイルを作る

```bash
cp wrangler.toml.example wrangler.toml
```

2. D1データベースを作る

```bash
npx wrangler d1 create graze-duel-rankings
```

表示された `database_id` を `wrangler.toml` の `database_id` に貼り付けます。
binding は `DB` のままにしてください。

3. テーブルを作る

```bash
npx wrangler d1 migrations apply graze-duel-rankings --remote
```

4. APIを公開する

```bash
npx wrangler deploy
```

公開後、WorkerのURLが発行されます。
ゲームをCloudflare Pagesで同じドメイン配下に置く場合は、`/api/ranking` でそのまま呼べる構成にします。
別ドメインのWorkerを使う場合は、ブラウザの開発者コンソールで一時的に以下を設定できます。

```js
localStorage.setItem("grazeDuelRankingApiBase", "https://YOUR_WORKER_URL");
```

## API

- `GET /api/ranking?type=time&limit=50`
- `GET /api/ranking?type=score&limit=50`
- `POST /api/ranking`

POST body:

```json
{
  "playerName": "AAA",
  "clearTimeMs": 123456,
  "score": 10000,
  "maxLevel": 31,
  "clientVersion": "prototype"
}
```
