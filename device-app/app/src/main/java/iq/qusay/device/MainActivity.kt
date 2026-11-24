package iq.qusay.device

// تطبيق «جهاز البيع»: يفتح صفحاتنا (المكتبة، محطة الليبل) جوة، ويطبع بطابعة جهاز SUNMI مباشرة بلا نافذة الطباعة.
// كل الشغل بالصفحات على السيرفر، فأي تعديل يوصل وحده بلا تنصيب جديد. التطبيق بس: صفحة + طابعة + كاميرا.
import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.os.Bundle
import android.print.PrintManager
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.sunmi.printerx.PrinterSdk
import com.sunmi.printerx.enums.Align
import com.sunmi.printerx.enums.ImageAlgorithm
import com.sunmi.printerx.enums.Status
import com.sunmi.printerx.style.BaseStyle
import com.sunmi.printerx.style.BitmapStyle

private const val HOST = "qusay-bot--qmath-v2.europe-west4.hosted.app"
private const val START = "https://$HOST/store/door"

class MainActivity : Activity() {
    private lateinit var web: WebView
    @Volatile private var printer: PrinterSdk.Printer? = null
    private var pending: PermissionRequest? = null

    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved)
        window.statusBarColor = 0xFF141F33.toInt()
        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString QDeviceApp/1"
        }
        web.webViewClient = object : WebViewClient() {
            // صفحاتنا تنفتح جوة، وأي رابط ثاني (مثل تليگرام) يطلع برا التطبيق
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                if (req.url.host == HOST) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, req.url)) } catch (_: Exception) {}
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            // الكاميرا لصفحة الدخول (الرمز المربع) ومحطة الليبل (كود الطالب)
            override fun onPermissionRequest(req: PermissionRequest) {
                runOnUiThread {
                    if (req.origin.host != HOST) { req.deny(); return@runOnUiThread }
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) req.grant(req.resources)
                    else { pending = req; requestPermissions(arrayOf(Manifest.permission.CAMERA), 1) }
                }
            }
        }
        web.addJavascriptInterface(Bridge(), "QApp")
        startPrinter()
        if (saved != null) web.restoreState(saved) else web.loadUrl(START)
    }

    override fun onSaveInstanceState(out: Bundle) { super.onSaveInstanceState(out); web.saveState(out) }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, results: IntArray) {
        val r = pending ?: return
        pending = null
        if (results.firstOrNull() == PackageManager.PERMISSION_GRANTED) r.grant(r.resources) else r.deny()
    }

    @Deprecated("زر الرجوع يرجع صفحة، مو يطلع من التطبيق")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed() }

    private fun startPrinter() {
        try {
            PrinterSdk.getInstance().getPrinter(applicationContext, object : PrinterSdk.PrinterListen {
                override fun onDefPrinter(p: PrinterSdk.Printer) { printer = p }
                override fun onPrinters(list: List<PrinterSdk.Printer>) { if (printer == null) printer = list.firstOrNull() }
            })
        } catch (_: Exception) { /* جهاز بلا طابعة SUNMI: الصفحات تشتغل، والطباعة بالطريقة العادية */ }
    }

    /** سبب المشكلة بالعربي، أو null إذا الطابعة جاهزة */
    private fun problem(p: PrinterSdk.Printer): String? = when (try { p.queryApi().status } catch (_: Exception) { Status.UNKNOWN }) {
        Status.READY, Status.UNKNOWN, Status.WARN_THERMAL_PAPER, Status.WARN_STANDARD_PAPER, Status.WARN_SPECIAL_PAPER -> null
        Status.ERR_PAPER_OUT -> "خلص الورق"
        Status.ERR_PAPER_JAM -> "الورق عالق"
        Status.ERR_COVER, Status.ERR_COVER_INCOMPLETE -> "غطاء الطابعة مفتوح"
        Status.ERR_PRINTER_HOT, Status.ERR_MOTOR_HOT -> "الطابعة حارة، انتظر شوية"
        Status.ERR_PAPER_MISMATCH -> "نوع الورق مو مناسب"
        Status.OFFLINE, Status.COMM -> "الطابعة مو متصلة"
        else -> null
    }

    inner class Bridge {
        @JavascriptInterface fun printerReady(): Boolean = printer != null

        /** وصل: صورة بعرض 384 نقطة. يرجع "" إذا انطبع */
        @JavascriptInterface fun printImage(b64: String): String {
            val p = printer ?: return "الطابعة مو جاهزة"
            problem(p)?.let { return it }
            return try {
                val bytes = Base64.decode(b64, Base64.DEFAULT)
                val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return "صورة الوصل خربانة"
                val line = p.lineApi()
                line.initLine(BaseStyle.getStyle().setAlign(Align.CENTER))
                line.printBitmap(bmp, BitmapStyle.getStyle().setAlign(Align.CENTER).setAlgorithm(ImageAlgorithm.DITHERING).setWidth(384).setHeight(bmp.height * 384 / bmp.width))
                line.autoOut()
                ""
            } catch (e: Exception) { e.message ?: "ما انطبع" }
        }

        /** ليبل الامتحان: أوامر TSPL. يرجع "" إذا انطبع */
        @JavascriptInterface fun printTspl(b64: String): String {
            val p = printer ?: return "الطابعة مو جاهزة"
            problem(p)?.let { return it }
            return try { p.commandApi().sendTsplCommand(Base64.decode(b64, Base64.DEFAULT)); "" } catch (e: Exception) { e.message ?: "ما انطبع" }
        }

        /** نافذة الطباعة العادية للصفحة المفتوحة (إذا الطباعة المباشرة ما نفعت) */
        @JavascriptInterface fun systemPrint() {
            runOnUiThread {
                val pm = getSystemService(PRINT_SERVICE) as PrintManager
                pm.print("وصل", web.createPrintDocumentAdapter("وصل"), null)
            }
        }
    }
}
