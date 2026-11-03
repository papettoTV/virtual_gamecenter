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


## 人用配置と保守操作の一括実行

`python3 tools/package-automatic-resume-control.py 出力先 --human-maintenance` でレビュー済みの信頼定義3件と固定した親SHA・全34ファイル一覧・ZIPハッシュをまとめる。管理端末で `--maintain ZIP` を実行すると、次の処理をまとめて行う。

1. 人が確認欄へ `ci-control` と入力し、管理端末専用のFine-grained PATとpulbase-releaseのPEMパスを非表示で入力する。認証値は保存・引数渡し・環境変数・ログ出力をしない。
2. 現在のbypass空・固定した保護設定版・2変数・mainの固定SHA/保護・stagingの承認/ブランチ制限・元の全34ファイルを確認する。
3. 非秘密の復旧記録を保存してから、ci-controlのルール25676153にpulbase-release（App ID 5405029）だけのAlways allowを追加する。対象・Active・禁止ルールは変更しない。
4. 人の鍵からContents writeだけの一時Appトークンを取得し、信頼定義3件だけを配置、他31件を保持する。一時トークンは処理終了時に失効する。
5. 成功・失敗・Ctrl-Cのいずれでもbypass削除を試み、空を読み返す。別のAppや保護ルール変更を検出した場合は上書きせず停止する。
6. 配置commitの親と全ファイルを検査し、削除後の設定版から `PULBASE_CONTROL_EVIDENCE_SHA` とstagingの `PULBASE_CONTROL_RULE_VERSIONS` を生成、更新、読み返す。main保護・staging承認条件も再検査する。配置失敗で元のSHAのままなら、SHAを維持して削除後のstrict設定版だけを復帰する。

管理端末専用PATはvirtual_gamecenterだけを対象に、**Administration write・Variables write・Environments write**を付ける（Metadata readは自動付与）。Contents/Workflows/Actions/Deployments/SecretsやAccountの権限は追加しない。GitHubのAdministration writeは保護ルール全般、Environments writeは環境設定も変更可能なので、AI用PATやAppへ追加せず、人の保管庫と管理端末だけで扱う。ツールのAPI書込フィルタは、ci-controlのルール1件のbypass（空またはpulbase-releaseだけ）と2変数、Appによる配置3ファイルに限定する。mainルール・承認API・Secret・main/develop refは書込対象外。

正常時はbypassの画面操作も2変数のコピー＆ペーストも不要。staging公開時の人の承認は1回のまま維持する。配置ツールはworkflowを起動しない。

通信断で削除を確認できない、強制終了や電源断でfinallyが動かない場合は、完了扱いにせず **再配置せず** `--cleanup ZIP` を管理端末で実行する。ツールはZIPの隣の `.maintenance.json` を読み、同じ対象のbypass削除とstrict・変数の再確認だけを行い、再配置や追加のbypass付与をしない。通信自体が復旧しなければ、最後の手段としてGitHub画面でpulbase-releaseだけを削除する。`.maintenance.json` / `.receipt.json` は鍵・トークンを含まない。復旧時に一時Appトークンの失効を証明できなければ、その点を結果へ明示する。

旧 `--apply` / `--apply-and-configure` は手動bypass方式、`--finish` は配置済み記録から2変数だけを更新する互換モードとして残す。いずれも設定の削除や認可検査の省略を行わない。
