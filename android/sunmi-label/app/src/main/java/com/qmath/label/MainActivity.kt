package com.qmath.label

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
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
    private lateinit var status: TextView
    private lateinit var startBtn: Button

    private val prefs by lazy { getSharedPreferences("station", Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        buildUi()
        link.setText(prefs.getString("link", ""))
        height.setText(prefs.getString("h", "39"))
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

    // ---------- الشاشة
    private fun buildUi() {
        val navy = Color.parseColor("#0F1A2E"); val gold = Color.parseColor("#D4A63A"); val cream = Color.parseColor("#F4F1E8")
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 60, 40, 40); setBackgroundColor(navy); layoutDirection = View.LAYOUT_DIRECTION_RTL }
        fun text(t: String, size: Float, bold: Boolean = false) = TextView(this).apply { text = t; textSize = size; setTextColor(cream); if (bold) typeface = Typeface.DEFAULT_BOLD; setPadding(0, 16, 0, 8) }
        fun button(t: String, primary: Boolean, click: () -> Unit) = Button(this).apply {
            text = t; textSize = 18f; isAllCaps = false
            setBackgroundColor(if (primary) gold else Color.parseColor("#1D2C4A")); setTextColor(if (primary) navy else cream)
            setOnClickListener { click() }
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = 20 }
        }
        col.addView(text("🖨 ليبل QMath", 26f, true))
        col.addView(text("1. بالبوت: 🎫 الحضوري ← 📋 انسخ رابط المحطة.\n2. هنا: 📋 الصق الرابط ← ▶️ ابدأ.\nالرابط يخلص كل يوم، فتلصق رابط جديد كل صباح.", 15f))
        link = EditText(this).apply { hint = "رابط المحطة"; setTextColor(cream); setHintTextColor(Color.GRAY); textSize = 14f; isSingleLine = true }
        col.addView(link)
        col.addView(button("📋 الصق الرابط", false) { paste() })
        col.addView(text("طول الليبلة بالملم:", 15f))
        height = EditText(this).apply { setTextColor(cream); textSize = 16f; inputType = InputType.TYPE_CLASS_NUMBER; gravity = Gravity.CENTER }
        col.addView(height)
        startBtn = button("▶️ ابدأ", true) { if (running) stop() else start() }
        col.addView(startBtn)
        col.addView(button("🧪 اطبع ليبل تجربة", false) { test() })
        status = text("", 17f, true).apply { setPadding(0, 40, 0, 0) }
        col.addView(status)
        setContentView(ScrollView(this).apply { setBackgroundColor(navy); addView(col) })
        say("جاري الاتصال بطابعة الجهاز...")
    }

    private fun say(t: String) = main.post { status.text = t }

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

    private fun save() = prefs.edit().putString("link", link.text.toString().trim()).putString("h", height.text.toString().trim()).apply()

    /** رمز المحطة من الرابط (…/store/station?k=…)، أو الرمز نفسه إذا انلصق بروحه */
    private fun token(): String? {
        val raw = link.text.toString().trim()
        if (raw.isEmpty()) return null
        return try { Uri.parse(raw).getQueryParameter("k") } catch (_: Exception) { null } ?: raw.takeIf { !it.contains("/") }
    }

    private fun labelHeight() = height.text.toString().toIntOrNull()?.coerceIn(20, 80) ?: 39

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

    private fun base(action: String) = JSONObject().put("station", token()).put("action", action).put("format", "png").put("h", labelHeight())

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
