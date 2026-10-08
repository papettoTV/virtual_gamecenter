#!/bin/zsh

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="5174"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

cd "$PROJECT_ROOT"

if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
  echo "Virtual Game Center server is already healthy."
  echo "Local:   http://localhost:${PORT}/"
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  if [[ -n "$LAN_IP" ]]; then
    echo "Network: http://${LAN_IP}:${PORT}/"
  fi
  exit 0
fi

PORT_PID="$(lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
if [[ -n "$PORT_PID" ]]; then
  PORT_COMMAND="$(ps -p "$PORT_PID" -o command= 2>/dev/null || true)"
  if [[ "$PORT_COMMAND" == *"$PROJECT_ROOT"* && "$PORT_COMMAND" == *"node_modules/.bin/vite"* ]]; then
    kill "$PORT_PID"
    sleep 1
  else
    echo "Port ${PORT} is occupied by another application:"
    echo "$PORT_COMMAND"
    exit 1
  fi
fi

exec npm run dev -- --host 0.0.0.0
