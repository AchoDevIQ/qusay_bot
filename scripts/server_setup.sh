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
cat > /etc/systemd/system/qmath.service <<UNIT
[Unit]
Description=QMath Telegram bot (Next.js)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$APP_DIR
ExecStart=$(command -v npm) run start
Restart=always
RestartSec=5
Environment=NODE_ENV=production

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
