#!/usr/bin/env bash
# CHAQIR backend — bir buyruqda: install (kerak bo'lsa) → seed → server + ngrok
# Ishlatish:  bash ~/chaqir-backend/start.sh
# yoki fish:  chaqir

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[chaqir] papka: $SCRIPT_DIR"

if [ ! -f package.json ]; then
  echo "[chaqir] XATO: package.json topilmadi. Avval chaqir-backend fayllarini shu papkaga yuklang."
  exit 1
fi

NEED_INSTALL=0
if [ ! -d node_modules ]; then
  NEED_INSTALL=1
elif [ ! -d node_modules/express ] || [ ! -d node_modules/better-sqlite3 ]; then
  NEED_INSTALL=1
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
  echo "[chaqir] npm paketlar ornatilmoqda..."
  npm install
  echo "[chaqir] npm install tayyor."
else
  echo "[chaqir] npm paketlar allaqachon bor — otkazib yuborildi."
fi

if [ ! -f data/chaqir.db ]; then
  echo "[chaqir] baza yoq — seed ishga tushirilmoqda..."
  mkdir -p data
  npm run seed
else
  echo "[chaqir] baza mavjud — seed otkazib yuborildi (qayta seed: rm data/chaqir.db* && npm run seed)."
fi

if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -t -i:3000 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "[chaqir] port 3000 band — eski jarayon tozalanmoqda..."
    kill -9 $PIDS 2>/dev/null || true
    sleep 1
  fi
fi

echo "[chaqir] server ishga tushmoqda (port 3000)..."
npm start &
SERVER_PID=$!

READY=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "[chaqir] server tayyor (pid $SERVER_PID)."
    READY=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[chaqir] XATO: server ishga tushmadi."
    exit 1
  fi
  sleep 0.5
done

if [ "$READY" -ne 1 ]; then
  echo "[chaqir] OGOHLANTIRISH: health check otmadi, lekin jarayon ishlayapti bolishi mumkin."
fi

cleanup() {
  echo ""
  echo "[chaqir] toxtatilmoqda..."
  kill "$SERVER_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

NGROK_URL="${NGROK_URL:-satisfy-endurance-mooned.ngrok-free.dev}"
if command -v ngrok >/dev/null 2>&1; then
  echo "[chaqir] ngrok: https://${NGROK_URL} -> 3000"
  echo "[chaqir] toxtatish: Ctrl+C (server ham ochadi)"
  ngrok http --url="$NGROK_URL" 3000
else
  echo "[chaqir] ngrok topilmadi — faqat lokal: http://localhost:3000"
  echo "[chaqir] toxtatish: Ctrl+C"
  wait "$SERVER_PID"
fi
