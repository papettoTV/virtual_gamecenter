# Issue #124: BUZZ BARRIERのタップ開始と共有整理

## 調査と実装

右上の隠れたボタンはGameScreenのgame-share-button（観戦用画面を共有）。request-cabinet-share → PlatformExperience → shareLiveという経路で、LiveShareButtonの「観戦に招待」と同じshareLive・ゲームID・筐体IDを使用する。同じ観戦URLと投稿先（Facebook、X、文章とURLのコピー）を提供していた。プレイヤーのREADY・一時停止中はゲーム内アイコンを外し、領域下の招待に一本化した。観戦者の共有、結果共有、開始確認ダイアログ内の共有は各文脈の機能として維持する。

開始前はprepareSoloで筐体を準備するだけ。今回の領域内ボタンもgameHost.requestPlay("start")を使用し、PlatformExperienceの確認・残高不足・登録回復経路、executePlayの予約・capture・開始認可・失敗時releaseを維持する。1タップで従来の開始確認へ進み、確認後に開始する。確認省略や課金の変更はしていない。表示枚数はGameDefinition.creditCostから取得する。連打は既存playRequested/confirmingPlayで処理する。

スマホ判定は#80のuseMobilePlayと同じ幅820px以下またはcoarse pointer。BUZZ BARRIERのプレイヤーREADYのみ領域全体をボタンとし、外側の開始行をレイアウトから外す。従来72vhだったcanvasへ開始行相当48pxを加える。プロフィールは通常ページの上部に固定配置を変更し、ゲーム前に64pxを確保するため、スクロールしても情報・操作へ追従して重ならない。

領域内ボタンはcanvasと別の要素で、pointerdownを移動入力へ渡さず、クリック（指を離した後）で開始確認を要求する。さらに実入力コントローラーもREADY中のpointerdownを拒否する。確認・共有・プロフィールメニューが開いている間の開始クリックも拒否する。開始後は既存のplaying通知から#80のCSS全画面へ入る。Fullscreen APIは不要で、iPhone向け代替表示も同じ経路。解除・一時停止・終了・退出・スクロール復元は既存処理を使用する。

共通GameScreenの共有一本化はDEEP SEA SALVAGEにも適用される。タップ開始・高さ・プロフィール配置の変更はBUZZ BARRIERのみ。深海ゲームの潜航・図鑑・PCキーは維持し、独立React画面のDOT WAVEには変更を適用しない。

## マージ前の検証

- 集中Vitest（spectator-pause-presentation、graze-duel-lifecycle）とnpm testはsandboxのlisten EPERM 127.0.0.1で起動失敗。合格とは扱わない。
- npm run build:stagingは成功（既存のチャンクサイズ警告）。デプロイは未実施。
- spectator-ui-layoutのNodeテスト、ブラウザspecの構文確認、git diff --checkは成功。
- READYで複数指を押したまま認可状態になっても移動せず、新しい操作で移動できる入力テストを追加。
- 独立Web checks用のplay-confirmationを新しい開始ボタンに更新。実ローカルguest・実予約/captureを使用する既存の取消、二重消費防止、開始失敗時release、残高不足からの回復、PCキー・観戦・他ゲームのケースを維持し、招待では開始しないこと、ダイアログ背後の複数指・重複クリック拒否を追加。
- mobile-playにはREADYの開始枚数表示、外側開始行の除去、高さ再配分、共有一本化を追加。既存の縦横表示・描画/移動・解除・終了・退出の復元ケースを維持。
- ブラウザ実行はローカル待受制限により未実施。独立CIでの実行が必要。

## マージ後の受け入れ確認

実デプロイ、関連PR・修正SHA・公開SHA照合、iPhone Safari/Android Chromeでの操作・共有URL・プロフィール・全画面解除・終了退出・スクロール復帰、PC/観戦/深海ゲームの回帰、証跡取得・Issueコメントは未実施。人によるstaging承認後に検証環境で日時・端末・条件別合否・証跡を記録し、未確認が残る間はIssueをopenに保つ。main・本番公開は対象外。
