# CI高速化（#121）

## 実行経路と成功条件

`実装:自動` Issue → Actionsで実装・PR → Web checks → 独立Codexレビュー → developへの自動マージ → developの初回Web checks → 保護されたci-controlで証跡照合 → 人がstaging承認1回 → 検証公開1回 → HTTP/ブラウザ回帰1回。

手元担当のPRも同じWeb checksを必須とし、developマージ以降の経路は共通。PRの候補と実マージ後のSHAは異なるため、両方のCIを残す。公開後の回帰は実際の配信先・SHA・HTTP・ブラウザの検査であり、ローカル受け入れ検査の代替にはしない。本番経路は今回変更しない。

## 変更前の実測

GitHub Actionsのjobs APIの `started_at` / `completed_at` とstep時刻から算出。ジョブ時間は実行開始から終了までであり、承認待ち・実行開始前の待ち時間は含まない。UI件数はログとJSONレポートで照合する。異なるケース数の実行を同条件の高速化率に使わない。

| 実行 | verify全体 | ローカルUI | npm test | DOT追加3回 | UI結果 |
| --- | ---: | ---: | ---: | ---: | --- |
| [41559752232](https://github.com/papettoTV/virtual_gamecenter/actions/runs/41559752232) develop 223db46 | 812秒 | 661秒 | 69秒 | 17秒 | 105成功・1skip |
| [41558321482](https://github.com/papettoTV/virtual_gamecenter/actions/runs/41558321482) PR #122 | 738秒 | 569秒 | 75秒 | 27秒 | 105成功・1skip |
| [41553307466](https://github.com/papettoTV/virtual_gamecenter/actions/runs/41553307466) PR #120 | 628秒 | 473秒 | 69秒 | 17秒 | 93成功・1skip |
| [41535143972](https://github.com/papettoTV/virtual_gamecenter/actions/runs/41535143972) develop dd6657d | 496秒 | 369秒 | 52秒 | 14秒 | 件数は今回の比較対象外 |

直近developのUIは全体の81%。ケース実行時間の合計はPC約302秒、スマホ約341秒。旧2実行はPR #122の追加12ケースを含まないため参考値とする。待ち時間と独立レビュー・stagingの実測は変更後の実行証跡へ追記する。

## 実装

- 単体検査とPC・スマホのUI検査を別ジョブで並列実行する。PC・スマホはそれぞれ独立したローカルWorker・DB・ゲストを持ち、各環境の1ワーカー・再試行0回・同じ全ケースを維持する。
- UIはPlaywrightのblobレポートを出力し、最終verifyでJSON・HTMLへ統合する。既存の `ui-evidence-<SHA>-<attempt>` を維持し、両projectの添付と失敗を独立レビューへ渡す。
- verifyは両ジョブに依存し、失敗・中断・skip・証跡欠落を成功扱いにしない。全成功後に同じSHAでビルド・成果物作成する。公開側の必須チェック名と実行全体の成功条件を変えない。
- 画面ケース・スクリーンショット・隔離・認証/クレジット検査は削除しない。DOT WAVEは過去の並列競合を防ぐ専用プロセスと追加安定性検査を維持する（導入commit d6992b0）。追加17～27秒の削減より、まずUIの直列待ちを解消する。

Playwright公式の[分割実行とレポート統合](https://playwright.dev/docs/test-sharding)を利用する。ブラウザの版・依存lock・CIの権限は据え置く。GitHubランナーの同時利用数と合計実行時間は増え得るため、短縮対象は経過時間とし、利用量も追跡する。

## 検証と配置条件

失敗・取消・skipの組合せ16通り、片側成果物欠落、異なる探索結果、blob欠落、実Playwrightの成功/失敗/skip/添付統合をブラウザなしで検査する。実UIは変更後のGitHub CIで確認する。

Web checksと定義検査は保護された信頼定義の対象なので、CI合格だけで保護側の固定値を書き換えない。差分を検証して人用配置ツールで信頼定義を配置し、bypass空・strict・固定SHAが再び一致してからdevelopへの反映とstaging確認へ進む。公開コード・鍵・承認ルールは変更しない。

#121は変更後の実測、実公開と回帰、Worker/PagesのSHA一致が揃うまで完了にしない。

## 変更後の初回実測

[PR #123 / run 41566438736](https://github.com/papettoTV/virtual_gamecenter/actions/runs/41566438736)（head 55bc064、候補bd9cc50）は全ジョブ成功。ランナー開始から最終verify終了まで420秒（7分）、直近developの812秒から392秒短縮（48.3%）。同じ106ケースを維持したPR #122の738秒との比較では43.1%短縮。PC53成功、スマホ52成功・1skip、再試行なし。全105成功ケースのproject・ファイル・タイトルの集合を変更前ログと照合して一致。

| 工程 | 実測 | 責務・重複の判断 |
| --- | ---: | --- |
| Actions受付→ランナー開始 | 2秒 | 実処理と分離して記録 |
| unit | 105秒（npm test 58秒、DOT追加17秒） | 会計・認可・ゲーム・Worker等の機能検査。UIと異なる検出対象を維持 |
| UI PC / スマホ | 368秒 / 357秒（ブラウザ実行318秒 / 294秒） | 端末固有の操作・表示を残して別DBで並列化 |
| Automation control checks | 20秒 | sandbox・保護・証跡の拒否条件。アプリ検査と独立 |
| 最後のverify | 50秒 | 証跡統合2秒、ビルド7秒。ここでだけ公開用成果物を作成 |
| 本番準備（公開なし） | 55秒、別workflow | 本番構成・移行・dry-runの検査。並列で完了し今回の最長経路ではない |
| Staging toolchain checks | 73秒、別workflow | 固定ツールチェーンの検査。公開先への書込なし |

新CIではジョブ合計約900秒、旧CIのverify＋制御約830秒から増加している。人の待ち時間を短縮する代わりに、ランナーの利用時間・成果物の一時保存量が増える。このトレードオフを隠さず記録する。

スクリーンショットの統合前blobは各projectの中間成果物に保存し、最終レビュー成果物への重複格納は避ける。JSON・HTML・画像添付は維持する。ケース内の250ms/1200msは予約・bootstrapの実通信遅延を意図的に作る検査で、処理完了待ちの無駄なsleepではないため削除しない。npmのlockfileキャッシュは既存。ciの依存取得は実測1秒なので、新たな広域キャッシュや版の異なるブラウザ再利用は導入しない。

## 承認・直列待ちと公開処理の区別

変更前の成功済み検証公開をjobs APIで確認：

| 実行 | 受付→prepare開始 | prepare | prepare終了→staging開始 | staging実処理 |
| --- | ---: | ---: | ---: | ---: |
| [41561263237](https://github.com/papettoTV/virtual_gamecenter/actions/runs/41561263237) | 3秒 | 15秒 | 552秒 | 125秒 |
| [41442838839](https://github.com/papettoTV/virtual_gamecenter/actions/runs/41442838839) | 4秒 | 21秒 | 30,519秒 | 119秒 |

中間の空白は承認待ち・runner待ち等を含む待機区間で、stagingの処理時間として合算しない。承認履歴ではpapettoTVのstaging承認を確認できるが、jobs APIだけでは待機区間を承認とrunnerへ厳密に分解できない。後者の8時間超をコード高速化の効果とは扱わない。

独立Codexレビューは自動担当PRだけで実施され、この手元担当PRでは既存仕様どおりskip。自動担当の候補CI/独立レビューの成功条件は維持し、全ケースの統合証跡を引き続き受け取れる。自動マージ・dispatch・公開前照合はそれぞれ現在のhead/base・実マージSHA・初回CI・固定定義・成果物ハッシュを検査し、役割が違うため省略しない。公開側の再ビルドは現行経路に存在せず、変更後もCI成果物を再利用する。

最終headの再計測と実公開・回帰はまだ未確認。


## 最終版の再計測・保護側配置

最終版3fd60cdの[41568260694](https://github.com/papettoTV/virtual_gamecenter/actions/runs/41568260694)も全合格。ランナー開始から終了まで455秒（7分35秒）、変更前812秒から44.0%短縮。初回420秒と合わせて2実行で短縮を再現し、成功105ケースの識別子集合と1skipを維持した。統合証跡は63,103,953 bytes（変更前99,097,083 bytes）。

人用ツールで制御SHA9c58d73893d264407f08268461b16d0464bbe7d5へ信頼定義3件だけを配置し、他31件保持・一時トークン失効・bypass空・main未変更を確認した。開発側の固定参照も新SHAと削除後のstrict設定版へ更新する。変数の人による更新と、更新後のdevelop CI・承認付き検証公開・回帰・SHA一致は引き続き必要。
