package com.qmath.label

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.sunmi.peripheral.printer.InnerPrinterCallback
import com.sunmi.peripheral.printer.InnerPrinterManager
import com.sunmi.peripheral.printer.SunmiPrinterService
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * محطة طباعة الليبل على جهاز SUNMI: تاخذ رابط المحطة من صفحة الحضوري، وتسأل البوت كل ثانيتين عن ليبل جديد،
 * وتطبعه صورة بطابعة الجهاز. قبل كل ليبل labelLocate حتى الطابعة تلگه بداية الليبلة، وبعده labelOutput حتى يطلع.
 */
class MainActivity : Activity() {
    private val host = "https://qusay-bot--qmath-v2.europe-west4.hosted.app"
    private val main = Handler(Looper.getMainLooper())
    private val pool = Executors.newSingleThreadExecutor()
    private var printer: SunmiPrinterService? = null
    private var running = false
    private var count = 0

    private lateinit var link: EditText
    private lateinit var height: EditText
    private lateinit var width: EditText
    private lateinit var shiftText: TextView
    private lateinit var status: TextView
    private lateinit var startBtn: Button

    private val prefs by lazy { getSharedPreferences("station", Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        buildUi()
        link.setText(prefs.getString("link", ""))
        height.setText(prefs.getString("h", "39"))
        width.setText(prefs.getString("w", "48"))
        showShift()
        takeLink(intent)
        bindPrinter()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        takeLink(intent)
    }

    override fun onDestroy() {
        running = false
        try { InnerPrinterManager.getInstance().unBindService(this, callback) } catch (_: Exception) {}
        super.onDestroy()
    }

    // ---------- الشاشة: نفس ألوان البوت، كحلي وذهبي، وشعار قصي العميري فوك
    private fun buildUi() {
        val navy = Color.parseColor("#0F1A2E"); val card = Color.parseColor("#17243D"); val gold = Color.parseColor("#D4A63A"); val cream = Color.parseColor("#F4F1E8")
        val dp = resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()
        fun round(fill: Int, stroke: Int? = null, r: Int = 14) = GradientDrawable().apply { setColor(fill); cornerRadius = px(r).toFloat(); if (stroke != null) setStroke(px(1), stroke) }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(px(16), px(20), px(16), px(24)); setBackgroundColor(navy); layoutDirection = View.LAYOUT_DIRECTION_RTL }
        fun text(t: String, size: Float, color: Int = cream, bold: Boolean = false) = TextView(this).apply { text = t; textSize = size; setTextColor(color); if (bold) typeface = Typeface.DEFAULT_BOLD; setPadding(0, px(4), 0, px(4)); setLineSpacing(0f, 1.2f) }
        fun button(t: String, primary: Boolean, click: () -> Unit) = Button(this).apply {
            text = t; textSize = 17f; isAllCaps = false; typeface = Typeface.DEFAULT_BOLD; stateListAnimator = null
            background = if (primary) round(gold) else round(card, gold)
            setTextColor(if (primary) navy else gold)
            setOnClickListener { click() }
            layoutParams = LinearLayout.LayoutParams(-1, px(52)).apply { topMargin = px(10) }
        }
        fun box(title: String) = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; background = round(card, Color.parseColor("#2A3B5C"), 16); setPadding(px(14), px(12), px(14), px(14))
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = px(14) }
            addView(text(title, 16f, gold, true))
        }
        fun field(hintText: String, numeric: Boolean) = EditText(this).apply {
            hint = hintText; setTextColor(cream); setHintTextColor(Color.parseColor("#8A94A8")); textSize = 15f; isSingleLine = true
            background = round(navy, Color.parseColor("#2A3B5C"), 10); setPadding(px(12), px(10), px(12), px(10))
            if (numeric) { inputType = InputType.TYPE_CLASS_NUMBER; gravity = Gravity.CENTER }
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = px(6) }
        }

        // الرأس: الشعار والاسم
        col.addView(ImageView(this).apply { setImageResource(R.drawable.logo); adjustViewBounds = true; layoutParams = LinearLayout.LayoutParams(-1, px(96)).apply { gravity = Gravity.CENTER } })
        col.addView(text("قصي العميري", 24f, gold, true).apply { gravity = Gravity.CENTER })
        col.addView(text("🖨 محطة طباعة الليبل", 15f).apply { gravity = Gravity.CENTER })

        // الحالة
        status = text("", 16f, cream, true).apply { gravity = Gravity.CENTER; background = round(card, gold, 16); setPadding(px(12), px(14), px(12), px(14)); layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = px(14) } }
        col.addView(status)
        startBtn = button("▶️ ابدأ", true) { if (running) stop() else start() }
        col.addView(startBtn)
        col.addView(button("🧪 اطبع ليبل تجربة", false) { test() })

        // رابط المحطة
        val linkBox = box("🔗 رابط المحطة")
        linkBox.addView(text("بالبوت: 🎫 الحضوري ← 📋 انسخ رابط المحطة، وبعدين الصقه هنا. الرابط يخلص كل يوم، فتلصق رابط جديد كل صباح.", 13f))
        link = field("رابط المحطة", false)
        linkBox.addView(link)
        linkBox.addView(button("📋 الصق الرابط", false) { paste() })
        col.addView(linkBox)

        // ضبط الليبل
        val fitBox = box("📐 ضبط الليبل")
        fitBox.addView(text("طول الليبلة بالملم", 13f))
        height = field("39", true); fitBox.addView(height)
        fitBox.addView(text("عرض الكتابة بالملم (إذا مقصوصة من الجهتين صغّره)", 13f))
        width = field("48", true); fitBox.addView(width)
        fitBox.addView(text("إذا الكتابة مقصوصة من جهة وحدة حركها. كل دسة 1 ملم وتطبع ليبل تجربة:", 13f))
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_LTR }
        fun half(t: String, d: Int) = button(t, false) { prefs.edit().putInt("dx", (prefs.getInt("dx", 0) + d).coerceIn(-20, 20)).apply(); showShift(); test() }.apply {
            layoutParams = LinearLayout.LayoutParams(0, px(52), 1f).apply { setMargins(px(4), px(10), px(4), 0) }
        }
        row.addView(half("⬅️ يسار", -1)); row.addView(half("يمين ➡️", 1))
        fitBox.addView(row)
        shiftText = text("", 13f).apply { gravity = Gravity.CENTER }
        fitBox.addView(shiftText)
        col.addView(fitBox)

        setContentView(ScrollView(this).apply { setBackgroundColor(navy); addView(col) })
        window.statusBarColor = navy
        say("جاري الاتصال بطابعة الجهاز...")
    }

    private fun say(t: String) = main.post { status.text = t }

    private fun showShift() {
        val d = prefs.getInt("dx", 0)
        shiftText.text = if (d == 0) "الطباعة بالنص" else if (d < 0) "متحركة لليسار ${-d} ملم" else "متحركة لليمين $d ملم"
    }

    // ---------- رابط المحطة
    private fun takeLink(i: Intent?) {
        val raw = when (i?.action) {
            Intent.ACTION_VIEW -> i.dataString
            Intent.ACTION_SEND -> i.getStringExtra(Intent.EXTRA_TEXT)
            else -> null
        } ?: return
        link.setText(raw.trim())
        save()
        if (!running) start()
    }

    private fun paste() {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val t = cm.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString()?.trim()
        if (t.isNullOrEmpty()) { say("⚠️ ما بيه رابط منسوخ. انسخه من 🎫 الحضوري أول"); return }
        link.setText(t); save(); say("✅ انلصق الرابط. دوس ▶️ ابدأ")
    }

    private fun save() = prefs.edit().putString("link", link.text.toString().trim()).putString("h", height.text.toString().trim()).putString("w", width.text.toString().trim()).apply()

    /** رمز المحطة من الرابط (…/store/station?k=…)، أو الرمز نفسه إذا انلصق بروحه */
    private fun token(): String? {
        val raw = link.text.toString().trim()
        if (raw.isEmpty()) return null
        return try { Uri.parse(raw).getQueryParameter("k") } catch (_: Exception) { null } ?: raw.takeIf { !it.contains("/") }
    }

    private fun labelHeight() = height.text.toString().toIntOrNull()?.coerceIn(20, 80) ?: 39
    private fun labelWidth() = width.text.toString().toIntOrNull()?.coerceIn(20, 48) ?: 48

    // ---------- طابعة الجهاز
    private val callback = object : InnerPrinterCallback() {
        override fun onConnected(service: SunmiPrinterService) { printer = service; say(if (running) "✅ شغال: ينتظر ليبلات" else "✅ طابعة الجهاز جاهزة. دوس ▶️ ابدأ") }
        override fun onDisconnected() { printer = null; say("⚠️ انقطعت طابعة الجهاز. سد التطبيق وافتحه") }
    }

    private fun bindPrinter() {
        try {
            if (!InnerPrinterManager.getInstance().bindService(this, callback)) say("⚠️ هذا الجهاز ما بيه طابعة SUNMI")
        } catch (e: Exception) { say("⚠️ ما انربطت الطابعة: ${e.message}") }
    }

    /** ليبل وحدة بمكانها: الطابعة تروح لبداية الليبلة، تطبع الصورة، وتطلعها */
    private fun printLabel(png: String) {
        val p = printer ?: throw IllegalStateException("طابعة الجهاز مو جاهزة")
        val bytes = Base64.decode(png, Base64.DEFAULT)
        val bmp: Bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw IllegalStateException("الصورة ما انفتحت")
        p.labelLocate()
        p.setAlignment(1, null)
        p.printBitmap(bmp, null)
        p.labelOutput()
    }

    // ---------- البوت
    private fun call(body: JSONObject): JSONObject {
        val c = URL("$host/api/attend").openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 15000; c.readTimeout = 30000
        c.setRequestProperty("Content-Type", "application/json")
        c.outputStream.use { it.write(body.toString().toByteArray()) }
        val code = c.responseCode
        val text = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
        val j = try { JSONObject(text) } catch (_: Exception) { JSONObject() }
        if (code >= 400) throw RuntimeException(j.optString("error", "صار خطأ ($code)"))
        return j
    }

    private fun base(action: String) = JSONObject().put("station", token()).put("action", action).put("format", "png").put("h", labelHeight()).put("w", labelWidth()).put("dx", prefs.getInt("dx", 0))

    private fun start() {
        if (token() == null) { say("⚠️ الصق رابط المحطة أول"); return }
        save()
        running = true
        main.post { startBtn.text = "⏸ وقف" }
        say("✅ شغال: ينتظر ليبلات")
        pool.execute {
            while (running) {
                try {
                    val job = call(base("next")).optJSONObject("job")
                    if (job != null) {
                        val name = job.optString("name")
                        say("🖨 دا يطبع: $name")
                        printLabel(job.getString("png"))
                        call(base("done").put("id", job.getInt("id")))
                        count++
                        say("✅ انطبع: $name\nاليوم انطبع $count ليبل")
                        continue
                    }
                } catch (e: Exception) {
                    val m = e.message ?: "صار خطأ"
                    say("⚠️ $m")
                    if (m.contains("الرابط انتهى")) { running = false; main.post { startBtn.text = "▶️ ابدأ" }; break }
                    Thread.sleep(3000)
                }
                Thread.sleep(2000)
            }
        }
    }

    private fun stop() {
        running = false
        startBtn.text = "▶️ ابدأ"
        say("⏸ واكف. الليبلات تنتظر لحد ما تدوس ▶️ ابدأ")
    }

    private fun test() {
        if (token() == null) { say("⚠️ الصق رابط المحطة أول"); return }
        save()
        // خيط بروحه، لأن خيط الانتظار يبقى شغال طول ما المحطة شغالة
        Thread {
            try {
                say("🖨 دا يطبع ليبل تجربة")
                printLabel(call(base("test")).getJSONObject("job").getString("png"))
                say("✅ انطبع ليبل التجربة")
            } catch (e: Exception) { say("⚠️ ${e.message}") }
        }.start()
    }
}
