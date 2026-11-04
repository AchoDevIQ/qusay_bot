#!/bin/bash
# تجهيز سيرفر QMath (Ubuntu) — يشتغل مرة وحدة من مجلد المشروع.
# قبل التشغيل: انسخ .env.example إلى .env.local وعبّي القيم.
# DB_PATH يقدر يأشر على store.db القديم، نفس الجداول.
set -e
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
echo ">>> 1/4 تنصيب البرامج..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl fonts-noto-core fonts-noto-color-emoji fonts-dejavu-core chromium || apt-get install -y curl fonts-noto-core fonts-noto-color-emoji fonts-dejavu-core chromium-browser
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
echo ">>> 2/4 بناء التطبيق..."
npm ci
npm run build
echo ">>> 3/4 تشغيل البوت كخدمة دائمية..."
# البوت يشتغل بمستخدم بلا صلاحيات: إذا صار اختراق، ما يوصل لباقي السيرفر
id qmath >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin qmath
mkdir -p "$APP_DIR/data"
chown -R qmath:qmath "$APP_DIR"
chmod 700 "$APP_DIR/data"
if [ -f "$APP_DIR/.env.local" ]; then chmod 600 "$APP_DIR/.env.local"; fi
if [ -f "$APP_DIR/settings.txt" ]; then chmod 600 "$APP_DIR/settings.txt"; fi
DB_FILE="$(sed -n 's/^DB_PATH=//p' "$APP_DIR/.env.local" 2>/dev/null | head -1)"
case "$DB_FILE" in /*) chown -R qmath:qmath "$(dirname "$DB_FILE")" ;; esac
if ! runuser -u qmath -- test -r "$APP_DIR/package.json"; then
  echo "!!! المستخدم qmath ما يوصل لمجلد المشروع. انقل المشروع إلى مكان مثل /opt/qmath (مو داخل /root) وشغل الملف مرة ثانية."
  exit 1
fi
cat > /etc/systemd/system/qmath.service <<UNIT
[Unit]
Description=QMath Telegram bot (Next.js)
After=network-online.target
Wants=network-online.target

[Service]
User=qmath
Group=qmath
WorkingDirectory=$APP_DIR
ExecStart=$(command -v npm) run start
Restart=always
RestartSec=5
UMask=0077
Environment=NODE_ENV=production
Environment=HOME=/home/qmath

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable qmath
systemctl restart qmath
sleep 6
echo ">>> 4/4 الحالة:"
systemctl --no-pager status qmath | head -15
echo
echo "=============================================="
echo "  اذا مكتوب active (running) فالتطبيق شغال ✅"
echo "  باقي: وجّه دومين HTTPS على المنفذ 3000، وبعدين:"
echo "  npm run set-webhook -- https://your-domain.com"
echo "=============================================="
