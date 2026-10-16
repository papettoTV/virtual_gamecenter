# PULBASE Xプロフィール画像

- アップロード用：`pulbase-x-profile-1024.png`（1024×1024、背景#090B18）
- 編集用：`pulbase-x-profile.svg`
- 表示確認：`preview.png`（丸い切り抜き、大サイズ・64px・40px）

サイト採用シンボル `apps/web/public/brand/pulbase-logo.svg` を形・配色を変えずに使用。白いP＋シアン#69F7FFの稲妻。文字は加えず、小さいプロフィール表示での識別を優先。丸く切り抜かれても欠けない余白を設けた。PNG寸法とプレビューを確認。Xアカウントへの設定は未実施。

再生成：`node deliverables/pulbase-x-profile/build.cjs`

## ヘッダー画像

1500×500 PNGと編集用SVGを3案作成。採用済みのサイト文字ロゴを使用。

- `pulbase-x-header-logo-1500x500.png`：文字ロゴのみ。
- `pulbase-x-header-tagline-1500x500.png`：文字ロゴ＋「本気のプレイが、人を呼ぶ。」。
- `pulbase-x-header-signal-1500x500.png`：控えめな信号線＋文字ロゴ＋カテゴリー。
- `header-comparison.png`：プロフィール画像の重なりを想定した比較。プロフィール画像は確認用で、アップロード用ヘッダーには含まない。X実画面での配置検証は未実施。

全案のPNG寸法と比較画像を確認。再生成：`node deliverables/pulbase-x-profile/build-headers.cjs`。
