# QMath

بوت تليجرام ومتجر قصي العميري، مبني بـ Next.js: المتجر، التسجيل، الأسئلة العلمية، البيع بالمكتب والمكتبات، ولوحة التحكم.

## التشغيل

يحتاج Node.js 24 أو أحدث، ومتصفح Edge أو Chrome أو Chromium لرسم ملفات PDF. البوت يشتغل بطريقتين:

- **الإنتاج: Firebase App Hosting.** قاعدة البيانات Firestore والملفات بـ Cloud Storage، والأسرار بـ Secret Manager (`apphosting.yaml`). نسخة وحدة بس (`maxInstances: 1`)، لأن البوت يرتب رسائل كل طالب بالذاكرة. الخطوات بـ `docs/firebase-deploy.md`.
- **محلياً أو على سيرفر دائم:** إذا `FIREBASE_PROJECT_ID` فارغ، قاعدة البيانات ملف SQLite (`node:sqlite`). هاي نفس الطريقة اللي تشتغل بيها الفحوصات.

ما يشتغل على استضافة serverless عامة مثل Vercel. البنية الكاملة، ونظام التصحيح AI، موجودة بـ `QMATH_ARCHITECTURE.md` بجذر المستودع.

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
| `DB_PATH` | مسار قاعدة بيانات SQLite (الافتراضي `data/store.db`)، إذا ماكو Firebase |
| `CHROME_PATH` | مسار المتصفح، إذا ما انلگه تلقائياً |
| `FIREBASE_PROJECT_ID` | مشروع Firebase. إذا محطوط، البوت يستعمل Firestore بدل SQLite |
| `FIREBASE_CLIENT_EMAIL`، `FIREBASE_PRIVATE_KEY` | حساب الخدمة، يلزم بس للتشغيل من الحاسبة |
| `FIREBASE_STORAGE_BUCKET` | مكان ملفات الامتحانات وصور الطلاب بـ Cloud Storage |
| `GRADING_AI_URL` | عنوان خدمة التصحيح AI (Cloud Run، من `grading-ai/`) |
| `GRADING_AI_KEY` | مفتاح خدمة التصحيح، نفس قيمة `BOT_KEY` بالخدمة. بدونه التصحيح AI طافي |
| `ANTHROPIC_API_KEY` | اختياري: جواب الأسئلة العلمية من صفحات الملازم مباشرة (`lib/booklets.ts`) |
| `AI_CACHE` | `0` يطفي حفظ نتائج التصحيح للصور والخطوات المتشابهة |

بالإنتاج هاي القيم تنحط بـ `apphosting.yaml` والأسرار بـ Secret Manager، مو بملف.

## الانتقال من نسخة Python

نفس الجداول، فانسخ `store.db` القديم وخلي `DB_PATH` يأشر عليه. وقف البوت القديم قبل ربط الـ webhook، لأن تليجرام ما يقبل الاثنين سوية.
صار `STORE_URL` لازم يأشر على هذا التطبيق بدل الموقع القديم، لأن الصفحات صارت على `/store` و`/store/reg` و`/store/pos`.

## البنية

الصورة الكاملة (المكونات، تدفق التصحيح AI، النشر) بـ `QMATH_ARCHITECTURE.md`. هنا وين يلگى المطور كل شي:

**المداخل**
- `app/api/telegram/route.ts`: يستلم رسائل تليجرام ويتأكد من `WEBHOOK_SECRET`.
- `app/api/*`: واجهات صفحات الـ Mini App ولوحة التحكم، كل مجلد إله `route.ts`.
- `app/api/cron/route.ts` و`lib/cronTick.ts`: دكة المؤقت كل دقيقة (رسائل بدء الامتحان، السيطرات، التقارير، والتصحيح AI بقفل لحاله).
- `app/store/`: صفحات المتجر والتسجيل والبيع والامتحانات والتصحيح ولوحة التحكم (React).

**منطق البوت**
- `lib/bot.ts`: يوزع الرسائل والأزرار. `lib/telegram.ts`: عميل Telegram Bot API.
- `lib/student.ts` و`questions.ts` و`office.ts` و`admin.ts`: منطق كل قسم.
- الامتحانات: `exams.ts` (فتحها بعد الشراء)، `examBank.ts` (النسخ والأسئلة)، `examRoom.ts` (غرفة الامتحان)، `schedApi.ts` (الجدول)، `inPerson.ts` (الحضوري)، `checkpoints.ts` (السيطرات).
- التصحيح البشري: `gradeApi.ts`، `objections.ts`، `graderPay.ts`.
- `lib/documents.ts`: ملفات PDF والوصولات والبطاقات.

**البيانات والملفات**
- `lib/db.ts`: Firestore إذا اكو `FIREBASE_PROJECT_ID`، وإلا SQLite (`firestoreDriver.ts`، `sqliteDriver.ts`). الجداول بـ `schema.ts`.
- `lib/files.ts` و`firebase.ts`: ملفات الامتحانات بـ Cloud Storage، أو مجلد على القرص محلياً.
- `lib/config.ts`: الإعدادات من `.env.local` أو `settings.txt` القديم.

**الحماية**
- `lib/webAuth.ts`: توقيع تليجرام للصفحات (24 ساعة)، ورموز البوت (لوحة التحكم أسبوع، صفحة الطالب 60 يوم)، ورابط ولي الأمر، ومفتاح المؤقت.
- `deviceLock.ts` (جهاز واحد للطالب)، `examLock.ts` (قفل المواد أثناء الامتحان)، `notes.ts` (اسم الطالب ورقمه على صفحات الملازم)، `guardianWatch.ts`.

**الذكاء الاصطناعي**
- `lib/aiGrade.ts` و`aiGradeApi.ts`: التصحيح AI. يدز الخطوات والصور لخدمة التصحيح (`grading-ai/`، Python على Cloud Run) على `/bot/grade`.
- `lib/qaBank.ts`: الأسئلة العلمية من الملازم عن طريق خدمة التصحيح (`/bot/qa` و`/bot/extract`).
- `lib/booklets.ts`: جواب السؤال من صفحات الملازم مباشرة من Anthropic، إذا `ANTHROPIC_API_KEY` محطوط بالبوت.
- `grading-ai/`: نسخة من محرك Math-Grading بجذر المستودع. التحديث مكتوب بـ `grading-ai/UPSTREAM.md`، وتعديل الجذر ما يوصل للبوت إلا بعد النسخ وإعادة النشر.

- `assets/`: صور الترحيب والنجاح، ومعها ملفات HTML المصدر مالتها.

## الامتحانات

المنتج يفتح امتحانات فصله إذا اسمه بيه «امتحانات» واسم الفصل، مثل `الفصل الأول - امتحانات إلكترونية`. الدفاتر والامتحانات الحضورية ما تفتح شي بالبوت.

- **البيع من المكتبة أو المكتب:** تنفتح للطالب مباشرة.
- **التوصيل:** الوصل المطبوع بيه كود QR ورمز مكتوب. لمن يوصل الطلب، الطالب يضغط الزر برسالة «تم تجهيز طلبك» ويمسح الكود، أو يكتب الرمز. الرمز يشتغل لصاحب الطلب بس، وبعد ما يتجهز الطلب.

### إدخال امتحانات فصل جديد

ملفات الامتحانات سرية وتبقى داخل `data/`، وما تنرفع على GitHub. على جهاز Windows بيه Word وPython:

```bash
pip install pymupdf
```

1. حول ملفي Word إلى PDF بـ `tools/export_word.ps1`.
2. شغل `tools/import_exams.py`، وهو يقص كل سؤال وجوابه إلى `data/content`، ويطبع النواقص. طريقة التشغيل مكتوبة بأول الملف.
3. أدخلها لقاعدة البيانات:

```bash
npm run load-exams -- ch1
```

بعدها كلشي يتعدل من لوحة التحكم ← 📝 الامتحانات: نوع النسخة (إجباري أو اختياري)، ووقت الامتحان، ودرجة كل سؤال، وصورة السؤال وجوابه. والتعديل إله صلاحية «📄 إدارة الامتحانات». إعادة الإدخال ما تمسح الأسئلة المعدلة.

## الفحوصات

```bash
npm test
npx tsc --noEmit -p .
```

خدمة التصحيح (`grading-ai/`) فحوصاتها بجذر المستودع: `python -m pytest -q`، وما تحتاج مفاتيح.

`tests/parity.test.ts` يقارن البوت ببوت بايثون القديم: كل سيناريو بـ `tests/parity/phase*.json` لازم يطلع نفس رسائل تليجرام، ونفس صفوف قاعدة البيانات، ونفس ملفات HTML المسجلة بـ `tests/parity/golden/`.
بعد إضافة سيناريو جديد، سجله من البوت القديم (يحتاج Python):

```bash
python tests/parity/record.py
```
