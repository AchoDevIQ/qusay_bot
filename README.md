# QMath

بوت تليجرام ومتجر قصي العميري، مبني بـ Next.js: المتجر، التسجيل، الأسئلة العلمية، البيع بالمكتب والمكتبات، ولوحة التحكم.

## التشغيل

يحتاج Node.js 24 أو أحدث (للـ `node:sqlite`)، وسيرفر دائم، لأن قاعدة البيانات ملف SQLite والبوت يرسم ملفات PDF بمتصفح Edge أو Chrome أو Chromium. ما يشتغل على استضافة serverless مثل Vercel.

```bash
npm install
cp .env.example .env.local
npm run build
npm start
```

بعد ما يصير عندك دومين HTTPS، اربط البوت بيه:

```bash
npm run set-webhook -- https://your-domain.com
```

على سيرفر Ubuntu، `scripts/server_setup.sh` يسوي كل الخطوات ويشغل التطبيق كخدمة.

## الإعدادات (`.env.local`)

| المتغير | الوصف |
|---|---|
| `TOKEN` | توكن البوت |
| `ADMIN` | أرقام حسابات المدراء |
| `STORE_URL` | عنوان هذا التطبيق، مثل `https://your-domain.com` |
| `WEBHOOK_SECRET` | نص عشوائي طويل يتأكد إن الطلبات جاية من تليجرام |
| `DB_PATH` | مسار قاعدة البيانات (الافتراضي `data/store.db`) |
| `CHROME_PATH` | مسار المتصفح، إذا ما انلگه تلقائياً |

## الانتقال من نسخة Python

نفس الجداول، فانسخ `store.db` القديم وخلي `DB_PATH` يأشر عليه. وقف البوت القديم قبل ربط الـ webhook، لأن تليجرام ما يقبل الاثنين سوية.
صار `STORE_URL` لازم يأشر على هذا التطبيق بدل الموقع القديم، لأن الصفحات صارت على `/store` و`/store/reg` و`/store/pos`.

## البنية

- `app/api/telegram/route.ts`: يستلم رسائل تليجرام.
- `app/store/`: صفحات المتجر والتسجيل والبيع (React).
- `lib/bot.ts`: يوزع الرسائل والأزرار.
- `lib/student.ts` و`questions.ts` و`office.ts` و`admin.ts`: منطق كل قسم.
- `lib/documents.ts`: ملفات PDF والوصولات والبطاقات.
- `assets/`: صور الترحيب والنجاح، ومعها ملفات HTML المصدر مالتها.

## الفحوصات

```bash
npm test
```

`tests/parity.test.ts` يقارن البوت ببوت بايثون القديم: كل سيناريو بـ `tests/parity/phase*.json` لازم يطلع نفس رسائل تليجرام، ونفس صفوف قاعدة البيانات، ونفس ملفات HTML المسجلة بـ `tests/parity/golden/`.
بعد إضافة سيناريو جديد، سجله من البوت القديم (يحتاج Python):

```bash
python tests/parity/record.py
```
