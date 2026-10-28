# 本番向け検査コードのci-control配置（公開なし）

## 今回の差分

親は`2c883a1cdd961510a0557742f74294739752f445`。以下5ファイルと配置manifestだけを追加する。既存28ファイルのblob/modeを前後で照合し、変更・削除・想定外ファイルを拒否する。

- ci/production-candidate/check.mjs
- ci/production-candidate/evidence.mjs
- ci/production-candidate/policy.json
- ci/production-settings-audit.mjs
- tools/read-production-evidence.py
- production-inspection-installation.json（配置元・既存/追加ファイルのハッシュ記録）

workflowは追加/変更/起動しない。Worker/Pages/本番DB・main/develop・Environment・Secret・変数は配置ツールの書込対象外。本番フラグを有効にせず、旧本番テンプレートも配置しない。配置後も本番の実処理は未接続である。

検査コードは旧制御SHAの証跡に加え、既存28ファイルをそのまま維持した新制御SHAの証跡にも対応する。配置後の現在SHAと、検証公開当時の制御SHAは別々に記録する。古い証跡の24時間制限・最新develop条件は緩和しない。

## 鍵なしの準備

コミット済みのソースで次を実行する。

```bash
python3 -B tools/package-production-inspection.py /private/tmp/pulbase-production-inspection-install
```

ZIP・単独配置ツール・package-report.jsonを生成する。ソースはHEAD、既存制御は固定親のGit objectから取得する。ZIPのSHA-256を配置ツールに固定し、ZIP単独で検査コードと既存制御を一時ディレクトリへ組み合わせてNodeテストを実行する。本番準備の6ファイルはテスト用の一時コピーだけで、配置ZIPには入れない。App鍵・API・デプロイは使わない。

配置ツールのAPPLY_RULE_VERSIONは初期値Noneで、配置を実行できない。人が例外を追加した後、完全なbypass一覧と設定版を独立した読取で確認し、単独配置ツールのその1値だけを固定してから実行手順を案内する。ZIPを作り直す必要はない。

## 人の管理操作

一度にすべて行わず、各段階を読み取り確認して進める。

1. CIと単独ZIP検査に合格した配置対象を確定する。
2. 人がci-controlのルール25676153へpulbase-release App（5405029）だけをAlways allowで一時追加する。Active・対象ci-controlのみ・4制限は維持する。管理者・本人・実装Appやmainルールは変更しない。
3. Codexは完全なbypass一覧と最新設定版をGETで確認し、配布する単独配置ツールにAPPLY_RULE_VERSIONを固定する。配布物のパスとハッシュを提示する。
4. 人が管理用ターミナルで固定済み配置ツールを実行する。人が保管するPEMのパスは非表示入力で、チャットやCodexへ鍵を渡さない。Keychain・GitHub Secretから鍵を取り出す処理はない。
5. ツールはContents書込のみ・当repoのみの一時Appトークンを発行し、固定親から追加tree/commitを作り、再照合後にci-controlだけをforce=falseで更新する。main/developのref、workflow、設定や公開先へ書くAPIは許可しない。成功・失敗とも一時トークン失効を試みる。
6. 人が一時例外を削除して保存する。結果JSONと削除完了の報告を受けて、Codexは新SHA・親・全ファイル・bypass空・main未変更を確認する。

失敗時は自動再試行しない。ref更新の応答が不明ならrefOutcomeUnknownを報告し、GitHub側の状態を読み取るまでツールを再実行しない。ツールが成功と表示しても、例外を残したまま完了にはしない。

## 既存自動化への影響と復帰

現在、develop自動マージには旧制御SHAと保護設定版がコード内に固定されている。配置・bypass操作の間は、既存のガードが不一致を検出して停止する。stagingのdispatcherもRepository variableに旧SHAが残っていれば新制御を起動しない。保護を外して運転を継続することはしない。

配置後、実際の新SHAと例外削除後の設定版が確定してから、develop側の自動マージ定義/テストの固定値を更新し、CI合格を確認する。人がRepositoryのPULBASE_CONTROL_EVIDENCE_SHAとstaging EnvironmentのPULBASE_CONTROL_RULE_VERSIONSを、確認済みの新値へ更新する手順を続けて案内する。production Environmentや本番フラグは変更しない。

復帰に必要な更新が残っている間は、Issueからの自動マージ・検証公開が通常運用可能と報告しない。人が設定値を更新する前に古いSHAの承認待ちを承認したり、停止した実行を再実行したりしない。

## 配置後の検証

まずGETで配置tree全体と保護を検査し、取得した固定コードを鍵なし・ネットワークなしの一時コピーでimport/テストする。本番候補の読取検査は、その後、証跡が揃う場合だけGETで行う。今回のコード配置を、実公開や本番経路の稼働成功と混同しない。
