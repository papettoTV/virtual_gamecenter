# 本番リリースの人の操作を1回にする

## 通常リリース

同じdevelop SHAの初回Web checks、本番準備CI、検証公開と回帰が揃うと、GitHub Actionsが自動で保護済みci-controlに候補を渡す。候補選択・起動・SHA入力は自動で行う。

人の操作はGitHub Actionsで本番候補と変更範囲を確認し、productionの「Approve and deploy」で承認する1回。古い候補、証跡の変更、再実行は停止する。承認後の処理は固定成果物の再照合、main昇格、WorkerとPagesの反映、本番HTTP・PC/スマホ回帰、成功時の手動X投稿文提示。

## 権限分離

- developの起動workflowは本番鍵を持たない。候補探索は読取だけ、起動ジョブはActions書込だけを追加する。
- 本番承認を受けるproduction環境は、保護されたci-controlだけに限定する。現在の承認者と管理者bypass禁止を維持する。
- mainへの昇格に例外が必要なら本番専用GitHub Appだけに付与し、別ルールの必須CI・force push禁止・削除禁止は維持する。Appの鍵と本番Cloudflare書込認証はproductionのみに保管し、管理者PATはCIに置かない。
- 承認後は候補、成果物、本番設定を再確認する。D1移行を伴う場合は対象DB、移行一覧、復元点を確認する。Workerの一般公開設定は維持する。

## 現段階

自動候補選択、固定ブランチへの起動、鍵なし予行試験を追加する。developの本番名workflowは登録だけを行う。予行試験テンプレートはci-controlへ配置し、ci-control限定・承認必須・Secretなしのproduction-rehearsal環境を利用する。予行試験は本番フラグfalseと予行試験フラグtrueを要求する。

実公開ジョブ、鍵なしビルド成果物の引き渡し、main保護定義の同期、本番切り戻しへの接続は後続。今回の変更では環境・権限・本番配信を変更しない。
