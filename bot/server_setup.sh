#!/bin/bash
# تجهيز سيرفر QMath (Ubuntu) — يشتغل مرة وحدة
set -e
cd /root/bot
echo ">>> 1/4 تنصيب البرامج..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y python3 python3-pip fonts-noto-core fonts-noto-color-emoji fonts-dejavu-core
echo ">>> 2/4 تنصيب متصفح رسم الصور والـ PDF..."
pip3 install --break-system-packages playwright
python3 -m playwright install --with-deps chromium
echo ">>> 3/4 تشغيل البوت كخدمة دائمية..."
cat > /etc/systemd/system/qmath.service <<'UNIT'
[Unit]
Description=QMath Telegram bot
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/root/bot
ExecStart=/usr/bin/python3 -u /root/bot/bot.py
Restart=always
RestartSec=5
Environment=PYTHONIOENCODING=utf-8

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
echo "  اذا مكتوب active (running) فالبوت شغال ✅"
echo "=============================================="
