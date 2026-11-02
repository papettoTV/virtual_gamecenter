# 公開素材・依存ライセンス台帳

更新：2026-11-03。Issue #119の最終技術棚卸し。基準はdevelop `dd6657d508f1139d237022d1e16c1c63f384abf8`。対象はローカルのpublic入力とstagingビルドであり、本番への接続・デプロイ・負荷試験は行わない。権利保証・商標判断・公開許諾の完了ではない。

## 今回の結論と確認範囲

- [全ファイル・ハッシュ・GLB・ビルド照合の記録](public-asset-audit-2026-11-03.json)と[運営者の確認票](asset-rights-owner-review.md)を作成した。確認票のR-01〜06は未回答で、LP-07全体は対応中。
- public入力は92ファイル、48,467,560 bytes（約46.22 MiB）。画像50点（PNG36/JPEG7/SVG6/ICO1）、GLB26点、MP4 3本、Blender原本3点、JSON4点、README1点、HTML3点、JS1点、配布制御1点。ゲームの見える画面だけでなく未参照ファイルも数えた。
- ローカルの`npm run build:staging`で91ファイルのバイト一致を確認。残る`.assetsignore`はCloudflare Viteプラグインが`wrangler.json`/`.dev.vars`の除外を追記して再生成する配布制御ファイルであり、素材の差し替えと区別する。追加25パスは生成JS/CSS・index.html・Pagesゲートウェイ等。CDN上の実配信や本番への反映を確認した結果ではない。
- GLB26点は全て`THREE.GLTFExporter r185`を記録し、JSON内のbuffers/imagesの外部URI・画像参照は0件。これは外部画像ファイル参照の検査であり、メッシュの原作者や参照資料の権利を証明するものではない。モデルmanifestの26パスと対応する。
- MP4 3本をffprobeで再実査し、H.264映像のみ・音声トラック0本を再確認。既存音声実査台帳のSHA-256とも一致した。Web Audioの合成音は動画内の音声とは別の確認対象。
- 新しいSNS用JPEG3点を対象へ追加した。#90/#113の技術的な承認・検証を、元素材の権利確認と混同しない。
- 制作原本3点・制作プレビュー2点・旧BUZZデモ2点・非採用MOCHIアイコン1点の計8点（26,979,762 bytes、約25.73 MiB）がビルドにも含まれる。除外を推奨するが、今回削除・移動・配布設定変更はしない。モデルmanifest・図鑑・provenanceは同じ理由で一括削除しない。

### 棚卸しの再実行

リポジトリルートで実行する。クラウドへの書き込み・通信は行わない。

```sh
npm --prefix apps/web run build:staging
node apps/web/scripts/audit-public-assets.mjs --built
node --test apps/web/tests/asset-policy.test.mjs
```

`audit-public-assets.mjs`はpublic全件のサイズ/SHA-256、GLBメタデータ、dist/clientとの同一性を標準出力へ返す読み取り専用ツール。シンボリックリンクは対象外として停止する。`.assetsignore`の再生成は`configurationChanges`、その他の変更は`changed`として報告し、素材の欠落・変更で終了コード1にする。音声の検査は別途`ffprobe -v error -show_entries stream=codec_type,codec_name -of json <動画パス>`で行う。追加・差し替え時は今回のスナップショットを上書きせず、確認日・基準SHA・新しい証跡を残す。

生成されたJS/CSSのライセンスは依存パッケージの表示確認と対応させる。動的なライブ映像、Canvas/WebGL描画、結果PNGは固定publicファイルの件数に含めず、それぞれゲームコード・モデル・文字描画の制作経路に追随する。外部サービスのロゴ・プロフィール画像、宣伝専用ディレクトリの権利を、この静的棚卸しで承認したとは扱わない。

### 検証記録（2026-11-03）

- `npm test`成功：通常Vitest856件とDOT WAVE/モード制限/セキュリティ/復元/解析/公開設定/監視等の標準スイート。公開設定・素材検査は23件、うち素材検査5件（新規3件）。
- `npm run build:staging`成功（型検査を含む）。既存の500 kB超チャンク警告は残る。生成物をCloudflareへ送信していない。
- CI制御198件、workflow/template構文検査11件成功。負荷試験ツールの検査やモックは遠隔負荷試験の合格へ読み替えない。
- 保存JSONと再実行結果の一致、manifestのGLB26パス、SNS画像3点のハッシュ、更新資料のローカルリンク64件を照合。
- Issue #119の専用PRでCIを別途確認する。ここでのローカル成功をGitHub CI・検証環境への新しいデプロイ・本番公開の完了とはしない。

## 判定の扱い

- 「制作経路あり」は、コード・生成記録・キャプチャ元を追跡できるという意味。素材の作者・入力参照素材・契約上の利用権を確認したこととは異なる。
- 商用利用だけでなく、ライブ観戦配信、SNSの結果画像、宣伝用動画、改変・再配布を用途として確認する。無料ベータでも未確認の第三者素材を無条件で使わない。
- ゲーム素材はルートMITの一括許諾対象としない。運営者による確認・条件・必要なクレジット表記を行単位で残す。

## 配布対象

### 運営者からの申告（2026-10-20）

- 「デモ動画の音源は、未確認。それ以外は素材から作成」と回答を受領。
- デモ動画の音源以外は、運営者による素材からの制作という申告として記録する。第三者素材の有無や、元素材の許諾・生成サービスの条件を個別に確認済みとまでは解釈しない。
- デモ動画の音源は明確な未確認事項として残す。公開前に対象動画と音源の出典・利用条件を確認し、確認できなければ音声トラックの除去または許諾済み音源への差し替えを行う。プレイヤー上のミュートだけを、配布ファイル内の音源を除去した扱いにはしない。
- 今回は申告の記録のみ。動画ファイルの変更、公開許諾の判定、外部公開は行っていない。

### サイト配布用デモの音声実査（2026-10-20）

運営者の申告とは別に、現在の`apps/web/public/`内のMP4全3本をffprobeで確認した。いずれもH.264映像トラックのみで、音声トラックは0本。プレイヤー設定のミュートではなく、ファイル内のストリーム検査による結果。ファイルの加工・音声除去は行っていない。

| 動画 | 長さ | 音声トラック | 確認したSHA-256の先頭12桁 |
| --- | --- | --- | --- |
| `demos/buzz-barrier/boss-demo-v1.mp4` | 12秒 | 0 | `b73d55e3d7af` |
| `graze-duel-promo.mp4` | 約9.867秒 | 0 | `d8d7e511da2c` |
| `dot-wave-promo.mp4` | 約6.667秒 | 0 | `911993e59808` |

完全なハッシュと検査方法は`apps/web/config/demo-media-audit.json`へ保存。`test:release`でpublicのMP4一覧・各ファイルのハッシュを照合し、追加・差し替え時には再確認を必要とする。このテスト自体がffprobeを再実行するわけではなく、実査済みファイルとの同一性を検査する。

この3本については「含まれる音源が未確認」という残課題は解消。2026-11-03にも同じハッシュと音声0本を再確認した。ただし映像自体・元素材の権利確認とは別であり、`deliverables/`等の宣伝動画に使う音源は未確認のまま。音声付きの宣伝素材を外部公開してよいという判定ではない。動画の稼働中環境でのバイト照合は今回実施していない。

| 素材・パス | 現在分かる制作経路 | 利用・表示 | 残る確認 |
| --- | --- | --- | --- |
| ゲームコードとCanvas/WebGL描画：`apps/web/src/games/` | リポジトリ内の実装。ソースコードはルートMIT | プレイ・観戦・キャプチャ | 外部から転用した表現・コードがないか、運営者確認。ゲーム名が既存作品の権利を保証するものではない |
| BUZZ BARRIERボス：`public/assets/buzz-barrier/bosses/*.png` | 同ディレクトリの`provenance.json`にOpenAI生成・ユーザー承認・切り抜き履歴あり | ゲーム・観戦表示 | 最初の参照画像の権利、利用した生成サービスの条件、第三者との類似性を確認 |
| ゲームアイコン：`public/assets/*-icon.*` | SVG/PNGを保持。全アイコン共通の作者・利用条件台帳は未整備 | トップ・共有 | 制作元・権利者・許諾・表示条件を運営者確認 |
| 深海モデル：`public/assets/deep-sea-salvage/models/*.glb` | `scripts/generate-deep-sea-models.mjs`、`generate-deep-sea-creatures.mjs`、モデルREADMEとmanifestあり | WebGL・図鑑 | 配布中の各ファイルが生成物または許諾済み改変物であること、外部テクスチャ等の有無を確認 |
| 図鑑画像：`public/assets/deep-sea-salvage/encyclopedia/*.png` | Blender撮影用`scripts/render-deep-sea-model-catalog.py`とREADMEあり | ゲーム内図鑑 | 使用モデルの確認に追随 |
| 背景：`public/assets/showroom/arcade-ambient-v1.jpg` | 隣接JSONにOpenAI生成・プロンプト・用途記録あり | トップ背景 | 運営者による入力素材・利用条件確認 |
| 現行BUZZデモ：`public/demos/buzz-barrier/boss-demo-v1.{mp4,jpg}` | 隣接JSONに宣伝素材のキャプチャ元・リビジョン・ハッシュを記録。音声トラック0本を実査 | 無音ループ映像。ライブではない | 元ゲーム・元映像の権利に追随 |
| 旧BUZZデモ：`public/graze-duel-promo.mp4`、`graze-duel-promo-poster.jpg` | 旧デモファイルもpublicに残る。音声トラック0本を実査 | 現行ゲーム定義では未採用でも配布候補 | 出典確認、または公開用ビルドから除外するかを決める |
| DOT WAVEデモ：`public/dot-wave-promo.mp4`、`dot-wave-promo-poster.jpg` | ファイルとゲーム定義の参照あり。音声トラック0本を実査 | トップ・筐体のデモ | 撮影元・映像の許諾を確認 |
| ブランド：`public/brand/*` | `deliverables/pulbase-brand-final/`に正本・生成スクリプト・manifestあり。文字とシンボルはパス構成 | ロゴ・favicon・OGP | 作者・素材契約・画像化した文字の利用条件、商標・ドメインの最終確認 |
| SNS固定画像：`public/social/*-ogp-v2.jpg`（3点） | #90の承認添付3枚と一致。#107で追加、#114でプレビュー定義を共通化 | 観戦/結果URLのOGP・X/FB共有パネル | 見た目の承認は元素材の許諾ではない。ゲーム画像・画像化された文字等の確認に追随。外部SNSでのキャッシュ・再配布を含む用途確認 |
| 音楽・効果音：BUZZ/DOTの`audio.ts`、DOTの`duel/audio.ts` | Web Audioの発振器・生成ノイズ。publicの音源ファイルは今回の走査でなし | ゲーム中の合成音 | コード由来であることと、既存楽曲・旋律の権利確認は別。宣伝素材側のBGMは下記の別管理 |
| UIフォント | CSSのsystem-ui / monospace等。publicにTTF/OTF/WOFFの配布なし | 端末のフォントを使用 | 将来Webフォント追加時は再確認。ロゴPNG内の文字は上のブランド項目で別確認 |
| React / React DOM / Scheduler / Three.js | インストール済み各パッケージのLICENSE全文とバージョンを収録 | `/third-party-notices.html`、フッター「ライセンス」 | 更新時は`test:release`が現行LICENSE・バージョンとの不一致を検出。新たなブラウザ依存追加時は対象一覧も更新 |

依存表示は2026-11-03にReact/React DOM 19.2.7、Scheduler 0.27.0、Three.js 0.185.1のLICENSE全文・版との一致を検査した。これらの依存表示が揃うことと、ゲーム画像・モデルの利用権確認は別である。

### 固定SNS画像の同一性

| ファイル | SHA-256 | 検証証跡 |
| --- | --- | --- |
| `social/buzz-barrier-ogp-v2.jpg` | `78936b2ab3f306b4646e6ef72dc168bb5b7a79a3a3c1e42f7d82f5de6fe28dc8` | [#90受け入れ記録](https://github.com/papettoTV/virtual_gamecenter/issues/90#issuecomment-6588423106) |
| `social/dot-wave-ogp-v2.jpg` | `dd016c80592ca966d5bd47a8f3e6096314772e0d8526124fed2fe117b234c7b2` | 同上 |
| `social/deep-sea-salvage-ogp-v2.jpg` | `3041d2378eddda0aed1a8a9d2d1f3a8b06d6b9daf260f41b47d29cf61faf5251` | [#113受け入れ記録](https://github.com/papettoTV/virtual_gamecenter/issues/113#issuecomment-6588423560) |

3点ともJPEG/1200×630。上記は2026-11-03のローカルハッシュと、検証環境`d626999`での既存受け入れ証跡の対応であり、本番配信・SNS実投稿の確認ではない。

パスの`public/`、`scripts/`は`apps/web/`からの相対。これらを確認済みの素材だけに差し替えたり削除したりする作業は、見た目・ゲームを変えるため別途判断する。

## アプリ外の素材

- `deliverables/`、`videos/`にはSNS・宣伝用素材がある。アプリpublicの棚卸しだけで外部公開可能とは判定しない。特にBGM、歓声、生成映像、Xのロゴ等は各provenance・許諾を別途確認する。
- 比較ロゴ用フォントは`deliverables/pulbase-logo-b/fonts/`にChakra Petch / Space Grotesk / Sora / Rajdhaniと各OFLファイルがある。現行アプリへのWebフォント配布は確認されない。過去のロゴや宣伝素材へ画像化して使った場合も制作元を追跡する。
- public配下にはBlenderの制作原本・プレビューもある。未参照でもビルドへ複製され得るため、第三者素材を入れてよい領域ではない。公開対象から制作原本・バックアップを分離する運用は残課題。

## 公開前に埋める記録

各未確認行について、運営者が「作者／制作方法」「入力・参照元」「許諾URL・取得日」「配信・宣伝・改変の可否」「必須表記」「確認者・日付」を記録する。生成履歴だけで権利確認済みとはしない。判断できない素材は差し替え・除外または個別許諾する。

現時点ではLP-07は**対応中**。商標の再調査・権利者の確認や契約条件の判断をこのコード点検で代替しない。
