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
