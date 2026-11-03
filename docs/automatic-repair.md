# 自動PRの修正継続

## 対象と実行順序

`実装:自動` の開いているIssueと、同じrepoの `pulbase-codex[bot]` による `codex/issue-N` → develop の既存PRだけを扱う。手元担当へ切り替えず、新しいPRを作らない。

1. Web checks / Codex PR verificationの初回完了、developへのpush、または明示した `実装:再開` を受付。
2. 現在headのCIが終了していること、担当、既存PRの一意性、変更許可範囲、最新developを照合。合格済みでもdevelop更新を取り込んでいなければ同期する。
3. 失敗ケースだけをUI成果物から、単体検査のFAILをunitログから、独立レビュー指摘をreview-gateログから抽出する。ZIPは展開/実行せずJSONだけを読み、画像添付は渡さない。診断は最大10KB、認証項目/鍵形式/URL/長いデータを除去する。診断自体は信頼しない。
4. 同じhead/baseへの重複受付を拒否し、Issueの信頼された受付コメントで3回までの修正履歴を数える。受付処理はrepo全体で直列化する。
5. 保護されたdevelop定義が発行したticketだけで同じ実装workflowへdispatch。受付はactorが `github-actions[bot]` であることも照合し、この受付に合格した場合だけCodex Actionの `allow-bots` を有効にする。人の通常起動には既存のwrite権限検査を維持する。エージェントにGitHub認証・APIアクセスを追加しない。
6. 最新developのコードでアプリ範囲の同期・競合候補を隔離runnerに準備する。エージェントはその差分だけを修正する。保護パスに競合があれば停止する。
7. App認証を持つ公開ジョブは候補コードを実行しない。元head・develop・担当を再照合して候補を再構築し、許可パス/通常ファイル/未解消マーカーを検査する。最終treeを元headとdevelopの両方を親にしたコミットとして既存PRへfast-forward pushする。一時候補は公開しない。
8. 新しいheadの初回CI・独立レビューを実行。不合格なら残りの範囲で繰り返し、合格なら既存のdevelop自動マージへ進む。

## 停止・通知

- 同じsnapshotの重複、古いCIイベントは再起動しない。
- CIが進行中なら次の完了イベントを待つ。
- 3回上限、診断が得られないAPI/実行環境の失敗、保護パス、担当/候補の変更は理由と実行リンクを対象Issueへ通知する。
- API利用枠不足を盲目的に再試行しない。失敗を無視してマージ・公開しない。
- 以前のrunのRe-run jobsや承認流用で通さず、新コミットの初回検査を使う。

## 公開境界

developへのマージ後は、固定CI成果物・SHA/ハッシュ照合 → staging承認1回 → 検証公開1回 → HTTP/ブラウザ回帰1回。strict・通常運用bypass空・sandbox・Secret隔離を維持する。main・本番・Xはこの修正処理の対象外。

## 初期適用

既存PR #125/#129/#131/#133へ、最終CIと信頼定義の人用配置・strict再固定が済んでから改善PRのdevelop反映で自動照合する。必要な既存対象は `実装:再開` でも同じ経路を起動できる。Issue #134は4件の実行証跡を確認するまで完了扱いにしない。


## 人用配置と設定更新

`tools/package-automatic-resume-control.py` でレビュー済みの信頼定義3件と固定した親SHA・全34ファイル一覧・ZIPハッシュをまとめる。人用の配置ツールは次の順に処理する。

1. 管理端末で、人が保管するpulbase-releaseのPEMを使って3件だけを配置する。取得する一時トークンはContents writeだけで、終了時に失効する。
2. ツールが待機したら、人がGitHub画面で一時bypassを削除・保存する。ツールは保護ルールを変更しない。
3. `strict` と入力し、管理端末専用のFine-grained PATを非表示で入力する。対象はvirtual_gamecenterだけ、Variables write・Environments write・Administration readだけ（Metadata readは自動付与）。Contents/Workflows/Actions/Deployments/Secretsへの権限は追加しない。GitHubのEnvironments write自体は環境設定変更も可能なので、この認証をAI・GitHub Secret・Keychain・共有端末へ渡さず、人の管理端末でだけ使用する。
4. ツールはbypassが空であることを省略されていない管理者API応答で確認する。配置commitの親・全ファイル、mainの固定SHA/保護、stagingの必須承認・ci-control限定を再確認する。
5. 配置SHAとbypass削除後の設定版から `PULBASE_CONTROL_EVIDENCE_SHA` とstagingの `PULBASE_CONTROL_RULE_VERSIONS` を生成し、既存値を照合してから更新する。保存後は両方と保護条件を再読取する。値の手入力は不要。

通常は `--apply-and-configure ZIP` を使う。配置成功時には鍵やトークンを含まない `.receipt.json` をZIPの隣へ保存する。設定更新中の失敗・中断からは **再配置せず** `--finish ZIP` で再確認する。片方だけ保存された場合も、元の値または今回の値に一致するときだけ残りを更新する。別の値・別の配置・bypass残存・APIによる未確認は停止し、ロールバックや書込の自動再試行を行わない。

設定用PATはプロセス内だけで使用し、保存・引数渡し・環境変数・ログ出力をしない。初回に管理用認証の準備は必要だが、以後の配置では2変数のコピー＆ペーストを行わない。配置ツールはworkflow起動・承認・main/develop更新・本番公開を行わない。
