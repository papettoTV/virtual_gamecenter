# 解析設定パネルの固定位置検査（Issue #109）

## 調査結果と修正根拠

元の1280px desktopの失敗はこの実装環境では未再現。元のCIには座標値やスクロール段階が残っていないため、アプリの配置不良と座標計測・描画同期不足のどちらかを断定できない。アプリや同意の意味、既定値、外部通信条件は変更していない。

従来の検査はPlaywrightのboundingBoxと設定上のviewportを別々に取得し、スクロール完了を確認していなかった。今回の検査ではrequestAnimationFrame内でgetBoundingClientRect、innerWidth/innerHeight、scroll位置をまとめて取得し、連続する2フレームで固定下端1px以内、横はみ出しなし、上端が画面内、スクロール・パネル寸法の安定を確認する。スクロール検査では指定した目標位置への到達も必須にする。許容幅・timeoutは拡大していない。

各段階のgeometry JSONには以下を保存する。ページ本文、URL、ストレージ、認証情報は収集しない。

- cycle、fraction、スクロール方式、目標座標
- 同一フレームのDOM矩形、layout viewport、visualViewport、scrollYとdocument寸法
- computed position/bottom/margin、全祖先のtransform/filter/perspective/contain/willChange等
- フォント準備状態、document準備状態、stylesheet数、計測時刻
- 後続のPlaywright boundingBox、設定viewport、DOM下端との座標差（別時点の参考値）

各段階につき最大20回の計測を残し、失敗したpollの値もfinally経由で保持する。afterEachで成功・失敗ともJSONを添付し、失敗時はスクリーンショットも添付する。今後のCIではDOM矩形の下端自体がviewportからずれているか、Playwrightの後続座標だけがずれるか、祖先の固定包含ブロックやフォント・スクロール状態が変わったかを比較できる。

初期描画の検査後、フォント準備完了を待ってスクロールを3巡する。中間の1巡はsmoothスクロールとし、描画途中の計測を含めて目標到達まで同期する。1280/390/320px、desktop/mobileの既存マトリクス、低い画面、全ボタン到達、閉じる・再表示、拒否・同意の保存は維持。他ゲームや#90の画像・メタデータ検査は変更していない。

## ローカル検証（公開前）

- `node --check apps/web/tests/ui/analytics-panel.spec.mjs`: 成功。
- `node --test apps/web/tests/analytics-runtime.test.mjs`: 成功。
- focusedブラウザ反復（analytics-panel、repeat-each=3）: PlaywrightのCLIが未導入で起動不可（MODULE_NOT_FOUND）。新しいブラウザケースの実行・安定性、実際のgeometry数値は独立CI待ち。依存関係の追加はしていない。
- apps/webで `npm test`: 失敗。Vitestのローカルサーバー待受で `listen EPERM 127.0.0.1`。後続のテスト群には到達していない。Wranglerのログディレクトリ作成エラーも出力された。
- apps/webで `npm run build:staging`: 終了コード0。型検査、Vite、Pages生成まで完了。Wranglerのログディレクトリ作成警告とバンドルサイズ警告あり。

元のCI失敗原因の確定、focusedブラウザ反復の成功、全UI・3ゲーム・画像検査を含むCI成功は未確認。独立CIの診断値に応じて、アプリ不具合が確認された場合は別途その根拠に沿った修正が必要。

## マージ後の受け入れ

独立レビュー、developへのマージ、最新実マージSHAの初回CI、staging承認・公開、公開後のブラウザ確認、Issueへの証跡記録はいずれもこの実装環境では実施していない。これらをローカルビルド成功で代替しない。公開後確認が完了するまではIssueの完了判断を行わない。
