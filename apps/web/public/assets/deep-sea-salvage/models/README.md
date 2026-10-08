# Deep Sea Salvage 3D model pipeline

BlenderからglTF 2.0 Binary（`.glb`）で書き出し、このフォルダーへ配置します。`manifest.json`の`models`に環境・ボス、`fishSpecies`に魚種ごとのURLを登録すると、通常ゲームと図鑑へ反映されます。

```json
{
  "version": 2,
  "models": {
    "submarine": { "url": "/assets/deep-sea-salvage/models/submarine.glb", "scale": 1 },
    "leviathan": { "url": "/assets/deep-sea-salvage/models/leviathan.glb", "scale": 1 }
  },
  "fishSpecies": {
    "sun-sardine": { "url": "/assets/deep-sea-salvage/models/sun-sardine.glb", "scale": 1 }
  }
}
```

## Blender書き出し規約

- 単位はメートル、+Xを進行方向、+Yを上、+Zを画面手前とする。
- 原点はモデル中心へ置き、回転と拡縮を適用してから書き出す。
- 潜水艦の全長は約4m、通常魚は約2mを基準とする。
- 材質はPBRのBase Color、Metallic、Roughness、Normal、Emissiveを使用する。
- テクスチャは2K以下を基本とし、モバイル用に1K版を用意する。画像はWebPまたはKTX2への変換を想定する。
- 不要なカメラ、ライト、非表示オブジェクトを含めない。
- 法線を再計算し、重複頂点と使用していない材質を削除する。

## 名前とアニメーション

- 潜水艦のプロペラは `propeller` と命名する。
- 魚の尾のルートは `tail` と命名する。
- ボーンアニメーションを含む場合は `idle`、`swim`、`turn`、`damage` の名前を使う。
- ボスは`leviathan`、岸壁表面は`cliffDetail`、海藻は`kelp`、熱水噴出口は`vent`をmanifestのキーに使う。

## 初稿モデルの再生成

- `node scripts/generate-deep-sea-creatures.mjs`で、潜水艦を変更せず魚20種、ボス、環境モデルを再生成する。
- Blenderをバックグラウンド実行して`scripts/render-deep-sea-model-catalog.py`を実行すると、図鑑PNGと`deep-sea-model-catalog.blend`を再生成する。
- 個別調整中は`-- --asset sun-sardine`のように指定し、対象の高解像度PNGだけを再撮影できる。`--asset`は複数指定可。
- `-- --catalog-only`でPNGを撮影し直さず、編集用`deep-sea-model-catalog.blend`だけを同期できる。
- `?game=deep-sea-salvage&modelCatalog=1`で全モデルを同条件で比較できる。

## 生物的な造形の共通仕様

- 魚体は頭部から尾柄まで連続した断面メッシュとし、胴体と尾を単純な図形で切らない。
- 体色は背側を暗く、腹側を明るくし、種ごとの斑・縞・不均一な色むらを頂点色で作る。
- 皮膚には微小な変位と高い粗さを与え、均一なプラスチック光沢を避ける。
- ひれは曲線輪郭・薄い厚み・半透明材質とし、付け根を魚体の内側へ重ねる。
- 眼球は眼窩に埋め込み、鰓は暗い細線で表現する。発光器以外の記号的な装飾パーツは避ける。

## 初期性能目標

- 通常魚：LOD0で5,000三角形以下、LOD1で2,000以下。
- 潜水艦：LOD0で20,000三角形以下、LOD1で8,000以下。
- ボス：LOD0で40,000三角形以下、LOD1で15,000以下。
- 岸壁は反復可能な区画へ分割し、同一材質を共有する。
- モバイルでは影を無効化し、描画解像度、岩壁分割数、水中粒子数を減らす。
