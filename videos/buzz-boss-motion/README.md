# ボス動作プレビュー

ゲーム本体に影響しない、実装前の確認用HyperFramesプロジェクト。

```sh
node build.mjs
npm run check
npx hyperframes preview --background
```

事前に `apps/web` の依存をインストールする。`build.mjs` は実ゲームの幾何モデル・回転関数とThree.jsを、Git管理外の `assets/` へコピーする。

球体は位置固定で回転のみ。結晶体の6本のトゲは2.4秒周期で同期して伸縮し、全体も回転する。形と動きを見やすく拡大表示し、ゲーム中の移動や弾幕は含めない。
