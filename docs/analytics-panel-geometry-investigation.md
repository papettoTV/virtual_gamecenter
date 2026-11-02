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

初期描画の検査後、フォント準備完了を待って、全6組合せで元からあるautoスクロール（0→0.5→1→0）を1巡する。追加のsmoothスクロール（同じ4段階）は、元の失敗が発生した1280px desktopだけで1巡し、描画途中の計測を含めて目標到達まで同期する。1280/390/320px、desktop/mobileの既存マトリクス、低い画面、全ボタン到達、閉じる・再表示、拒否・同意の保存は維持。他ゲームや#90の画像・メタデータ検査は変更していない。

## 追加反復の整理と既存CIの証跡

Issueに提示された既存head `ade82684bcfadeb31637937440a19cde83a0a6c2` の通常CI（[41404548389](https://github.com/papettoTV/virtual_gamecenter/actions/runs/41404548389)、10分46秒）は全成功。成果物13122688643のgeometryは8ケースすべて成功、1280/390/320pxのdesktop/mobile各16段階、各10.8～14.4秒で、全計測のDOM下端差・後続Playwright下端差・設定viewportとの差が0と報告されている。この実装環境から成果物への再アクセスは行っていない。3巡（auto/smooth/auto）の成功証跡として保持するが、元の失敗の再現や原因確定とは扱わない。

同じ候補の検査41404548406は成功CI成果物の固定待機上限で停止し、独立レビューは未実施と報告されている。そのため追加した重複auto巡を削り、追加smooth巡を代表1組合せへ絞った。スクロール段階は全6組合せ計72段階から28段階へ減る。既存8ケース、初期表示・再表示・選択保持・低い画面・全操作、2連続フレームの各安全条件、目標到達・安定、最後のCDP比較、失敗時のgeometry・画像は変更しない。許容px、timeout、アプリ、CI/CDも変更しない。固定された候補待機内で独立レビューへ進めるための整理であり、実行時間短縮の実測は独立CI待ち。

## 今回のローカル検証（公開前）

- `node --check apps/web/tests/ui/analytics-panel.spec.mjs`: 成功。
- `node --test apps/web/tests/analytics-runtime.test.mjs`: 成功。
- focusedブラウザ反復（analytics-panel、repeat-each=3）: PlaywrightのCLIが未導入で起動不可（MODULE_NOT_FOUND）。新しいブラウザケースの実行・安定性、実際のgeometry数値は独立CI待ち。依存関係の追加はしていない。
- apps/webで `npm test`: 失敗。Vitestのローカルサーバー待受で `listen EPERM 127.0.0.1`。後続のテスト群には到達していない。
- apps/webで `npm run build:staging`: 終了コード0。型検査、Vite、Pages生成まで完了。バンドルサイズ警告あり。

元のCI失敗原因の確定と、今回の追加修正後のfocusedブラウザ反復・全UI・3ゲーム・画像検査を含むCI成功は未確認。独立CIの診断値に応じて、アプリ不具合が確認された場合は別途その根拠に沿った修正が必要。

## マージ後の受け入れ

独立レビュー、developへのマージ、最新実マージSHAの初回CI、staging承認・公開、公開後のブラウザ確認、Issueへの証跡記録はいずれもこの実装環境では実施していない。これらをローカルビルド成功で代替しない。公開後確認が完了するまではIssueの完了判断を行わない。
