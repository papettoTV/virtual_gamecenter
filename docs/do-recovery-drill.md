# 実DOを含む停止・復元・再開訓練

実施日：2026-10-20。EN-08 / EN-09 / DL-04の追加検証。短時間の機能訓練であり、保留中の長時間負荷試験の代わりではない。

## 対象と非対象

- 専用Worker/D1/R2：`pulbase-recovery-drill-20261020-do`。D1 IDは `760f45a4-6750-4e44-bbbe-b6ba37bd66dd`。前回のDBとも共有しない。
- 一連の訓練バージョン：`cd151172-4f58-4489-acab-1e07ae0ca7a6`。後片付け用の予算回収アラーム取消を加えた最終版：`6e281706-2f3a-4484-908e-55a3639ef8c9`。公開routes・workers.dev・preview URL・Cronなし。実DOは専用namespaceの `CabinetRoom` / `AbuseGuard` / `RecoveryControl`。
- Cloudflareの認証済みService Bindingからだけ操作する。`RecoveryOperator` は名前付きRPC entrypointであり、管理用HTTP APIは追加しない。既存Google/Stripe/Basic認証のSecretはコピーしない。
- ローカルプロキシは `127.0.0.1:8797` のみでlistenする。ブラウザ確認は `http://pulbase-recovery.localhost:8797/`。専用ホストによりCookieを分離し、既存のローカルURL補正で5174へ移動することも避ける。プロキシは許可ホスト・同一Originを検査してから非公開Workerへ転送する。
- 実利用者を含む既存検証サイト・本番・main・DNS・既存の監視通知は変更しない。実Google再ログイン・実Stripe照合・一般公開の切替は対象外。

## 追加した停止機構

1. `RECOVERY_CONTROL` bindingがある環境だけ、全HTTP/新規WSの入口を独立DOで判定する。bindingがなければ従来通り。既存環境には今回このbindingを追加していない。
2. 初期状態はstopped。`stop` は最初に入口を閉じ、DB上のUUID筐体と以前保存した筐体IDを回収する。ID一覧はD1とは独立した制御DOへ保存するため、DB復元で筐体が一覧から消えても再整合対象を失わない。
3. 各筐体DOへ停止を永続化し、全ソケットをrevokedにして1012で切断、全筐体接続枠を返却する。停止中は新規UpgradeとWS操作、通常の切断時DB更新、期限切れ掃除を止める。制御DO/筐体DOの再起動後にも停止を維持する。接続枠が0になった後、admissionと16予算shardの既存回収アラームも取り消す。再開後に通常のconsume/admitが呼ばれると通常の回収予定が再設定される。
4. HTTPは503・no-store・Retry-After、画面はメンテナンス案内になる。停止制御の取得失敗も503。通常の毎時データ削除は停止中に実行せず、利用量記録の別Cron分岐は維持する。
5. `reconcile` はstoppedのときだけ実行。独立R2から削除を実DOへ再適用し、復元セッション/再認証/削除確認を全失効。未消費のactive予約をreleased、既存プレイセッションをendedにする。筐体の対戦・待ち行列・ソロ継続状態・観戦keyframe/event/motionバッファを空にする。
6. 削除pending、セッション、ウォレットと台帳の不一致、接続枠の残留があれば停止を維持する。整合した場合もreadyで止め、まだHTTP/WSは開かない。検証エラーを `blockConcurrencyWhile` の外へ漏らしてDOをリセットするのではなく、停止状態と安全なエラーコードを返す。
7. `resume` はreadyでのみ実行し、整合条件をもう一度検査。筐体を解除した後、最後に入口をopenへ変更する。途中失敗では入口を開かない。管理操作の成功だけでなくHTTP/WS/残高を別途確認する。

消費済みクレジットを勝手に払い戻す処理は追加しない。中断分の補償方針、復元時点以後の付与/消費/購入の外部照合は別途判断が必要。台帳との内部一致だけでは、復元で失われた外部イベントまで正しいとは証明できない。

## 実測結果

| 検査 | 結果 |
| --- | --- |
| 初期準備 | 専用DBへ0001〜0021、合成2人（無料各5枚、存続側は合成購入5枚）を準備。初期整合確認→明示再開 |
| 実プレイ・観戦 | 2筐体で各1プレイヤー/1観戦者、計4実WS。クレジット予約/消費・開始・各1keyframeのライブ配信成功 |
| 停止 | 全4接続1012、全接続枠0、HTTP/書き込み/新規WSは503、整合前resume拒否。試行時の空筐体も含め実UUID筐体3件を回収 |
| 復元bookmark | `00000003-00000046-00005109-6c28b5c0dade91502d2e3233518b88ee`。削除後に専用DBだけを実Time Travel復元 |
| 復元取り消し用bookmark | `00000003-ffffffff-00005109-1cfdf96e5216b1e738abade7a703f34c` |
| 復元直後 | 削除対象1人・旧セッション2件・soloPlaying 2件がDBに復活、DB削除受付0件。独立DOはstopped/suspended・接続0・枠0を維持 |
| 不整合の拒否 | 存続側の合成無料残高を4→7へ一時変更。再削除後でも台帳不一致により `recovery_data_not_ready`、停止維持。4へ戻して再試行成功 |
| 再整合 | 実DOを使って削除対象を再削除。全復元セッションを失効し、3筐体すべてempty・接続0・hasReplay=false、枠0。readyでも入口は閉じたまま |
| 再開 | 旧2セッション401。匿名観戦の再接続成功、古いkeyframeなし。存続側に訓練専用の新セッションを発行し、新規予約/消費/開始成功。無料4→3、合成購入5枚は維持（実Google/Stripe未使用） |
| ブラウザ | 専用プロキシのメンテナンス画面と、専用ホストでのPULBASEトップ再表示を確認。最初の127.0.0.1での再読込は既存補正で5174へ移動したため、再開証跡に使わず、Cookieを分離した専用ホストで再確認 |

最初の試行は専用Workerのレート制限binding不足で503となり、制限を弱めず訓練専用namespaceを追加した。予約APIの成功200を201と期待していた訓練スクリプトも修正した。失敗試行を成功に数えない。getPlatformProxyでの合成セッション準備が停滞した際は、自分の接続だけ終了し、専用DBに限定したD1コマンドで準備した。

## 再実施

- `config/do-recovery-drill.example.json` をもとに新しい専用Worker/DB/R2を作り、ID・パスを置換する。namespaceやD1/R2を本番/通常検証へ向けない。レート制限も専用のIDを使う。公開URLとCronを付けない。
- 配備前に `validateDoRecoveryConfig` と `wrangler deploy --dry-run` で検査する。実DOのremote binding単独利用は未対応のため、[公式の対応表](https://developers.cloudflare.com/workers/local-development/bindings-per-env/)に従い非公開WorkerのService Bindingを使う。
- `scripts/do-recovery-proxy.ts` をmainに、default entrypointへのremote Service Binding `DRILL` だけを付けた一時configで `wrangler dev --ip 127.0.0.1 --port 8797 --inspector-port 0` を起動する。デプロイしない。
- `npm run recovery:do-drill -- <専用Worker config> reconcile|resume|status|rooms|stop` で操作する。新設の空DBに対して初期reconcile/resumeし、[前回の合成データ準備](recovery-drill.md)を行う。Workerと同じDB/R2に限定したデータ専用configを別途使う。
- `exercise-stop` が返すbookmarkを保存する。次に `deleteFixture`、専用D1のTime Travel復元、`rooms` とD1の読取照合を実施する。復元コマンドは前回同様に対象IDを直前確認する。
- 不整合時の拒否を確認したら合成値を戻し、`reconcile`→readyの確認→`resume`→`verify-resumed`。CLI内のネットワーク確認先はloopback8797固定。新セッション発行は合成存続プレイヤーに限り、通常のログイン機能の代替として公開しない。
- 終了時は `stop`→`reconcile`→`stop`→`rooms` で、全セッション失効・空筐体・接続/枠0・stoppedを確認する。ローカルプロキシと自分の一時接続を終了する。専用DOの筐体掃除alarmも停止する。

## 残る公開前確認

訓練終了時は全セッションを再失効し、3筐体すべてempty/suspended・接続0・hasReplay=false・全接続枠0・制御stoppedを確認。最終版の更新直後の停止では汎用エラーが1回返ったが、停止/空筐体/枠0が維持されていることを読取確認し、停止だけを1回再試行して成功した。原因を伝播遅延などと断定しない。R2はr2.dev無効、カスタムドメインなし。全662テスト・型検査・検証ビルド成功（既存の大きいチャンク警告は残る）。通常の検証Pagesの読取7項目も07:40 JSTに全200、35〜248msで成功。

先行した復元訓練1コミットだけを `origin/develop` へpush済み：`db708db`（元 `7e291e8`）。公開対象ツリーの609テスト・型検査・検証ビルド成功。GitHub CI初回は変更外のDOT WAVEテストの5秒タイムアウトで失敗したが、コードを変えず失敗ジョブを1回再実行して成功を確認（[実行39333934388](https://github.com/papettoTV/virtual_gamecenter/actions/runs/39333934388)）。今回追加した実DO訓練のコードは別のローカルコミットとし、追加pushや既存アプリのデプロイは行わない。

- このbindingを既存検証/本番へ導入する作業、既存利用者に影響する停止/再開は今回実施していない。別途対象・時間帯・承認を決める。
- 復元時点後の変更履歴の突合、実OAuthでの再ログイン、実Stripeの購入突合、運営補正/補償の手順は残る。
- 正常・失敗・再試行を含む小規模機能訓練であり、同時競合や全利用者が稼働する状態での無損失停止、復旧時間、長時間の接続安定性を保証しない。長時間負荷試験は未合格のまま保留。
