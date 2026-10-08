#!/bin/sh
set -eu

vars_file="${1:-.dev.vars}"

if ! command -v stripe >/dev/null 2>&1; then
  echo "NG: Stripe CLIがインストールされていません。"
  exit 1
fi

if [ ! -f "$vars_file" ]; then
  echo "NG: $vars_file がありません。"
  exit 1
fi

secret_key=$(sed -n 's/^STRIPE_SECRET_KEY=//p' "$vars_file" | tail -n 1)
webhook_secret=$(sed -n 's/^STRIPE_WEBHOOK_SECRET=//p' "$vars_file" | tail -n 1)

case "$secret_key" in
  sk_test_*replace_me*|sk_test_) echo "NG: STRIPE_SECRET_KEYをテスト用Secret Keyに置き換えてください。"; exit 1 ;;
  sk_test_*) ;;
  sk_live_*) echo "NG: ローカル開発では本番用Secret Keyを使用できません。"; exit 1 ;;
  *) echo "NG: STRIPE_SECRET_KEYが未設定です。"; exit 1 ;;
esac

case "$webhook_secret" in
  whsec_*replace_me*|whsec_) echo "NG: STRIPE_WEBHOOK_SECRETをStripe CLIの値に置き換えてください。"; exit 1 ;;
  whsec_*) ;;
  *) echo "NG: STRIPE_WEBHOOK_SECRETが未設定です。"; exit 1 ;;
esac

echo "OK: Stripeテスト決済のローカル設定が完了しています。"
