#!/bin/sh
set -eu

if ! command -v stripe >/dev/null 2>&1; then
  echo "Stripe CLIがありません。先にインストールしてください。"
  exit 1
fi

exec stripe listen \
  --events checkout.session.completed \
  --forward-to "${STRIPE_WEBHOOK_FORWARD_URL:-http://localhost:5174/api/platform/stripe/webhook}"
