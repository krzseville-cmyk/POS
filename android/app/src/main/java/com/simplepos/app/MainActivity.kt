package com.simplepos.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Shows the POS web app (bundled in assets) full screen and connects the few things
 * a web page cannot do on its own inside an app: saving files, picking a backup to
 * import, printing (Android printing or a Bluetooth receipt printer), scanning
 * barcodes with the camera, and the system Back button.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var pendingSave: PendingSave? = null

    private class PendingSave(val text: String)

    private val printer by lazy { BluetoothPrinter(this) }
    private val printQueue = Executors.newSingleThreadExecutor()
    private var afterBluetoothPermission: ((Boolean) -> Unit)? = null

    private val requestBluetooth = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val next = afterBluetoothPermission
        afterBluetoothPermission = null
        next?.invoke(granted)
    }

    // "Import JSON" in Settings: hands the picked file back to the page's <input type="file">.
    private val pickFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileChooserCallback ?: return@registerForActivityResult
        fileChooserCallback = null
        callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
    }

    // CSV and JSON exports: the user chooses where to save, then we write the text there.
    private val createFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val save = pendingSave ?: return@registerForActivityResult
        pendingSave = null
        val uri = result.data?.data
        if (result.resultCode != RESULT_OK || uri == null) return@registerForActivityResult
        try {
            contentResolver.openOutputStream(uri)?.use { it.write(save.text.toByteArray(Charsets.UTF_8)) }
                ?: throw IllegalStateException("No output stream")
            toast(getString(R.string.file_saved))
        } catch (e: Exception) {
            toast(getString(R.string.file_save_failed))
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        val root = FrameLayout(this).apply { setBackgroundColor(getColor(R.color.background)) }
        webView = WebView(this)
        root.addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        // Keep the page clear of the status bar, navigation bar and on-screen keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        // Serving assets from an https origin gives the page normal, persistent localStorage.
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
        }
        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            // The app only shows its own pages; anything else opens in the browser.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == APP_HOST) return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (_: ActivityNotFoundException) {
                }
                return true
            }
        }
        // A WebChromeClient is needed for the page's confirm() prompts and file picker to work.
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = callback
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                }
                return try {
                    pickFile.launch(intent)
                    true
                } catch (_: ActivityNotFoundException) {
                    fileChooserCallback = null
                    false
                }
            }
        }
        webView.addJavascriptInterface(PosBridge(this), PosBridge.NAME)

        // Back closes an open popup or returns to the register before leaving the app.
        onBackPressedDispatcher.addCallback(this) {
            webView.evaluateJavascript("window.posHandleBack ? posHandleBack() : false") { handled ->
                if (handled != "true") {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                    isEnabled = true
                }
            }
        }

        if (savedInstanceState == null) {
            webView.loadUrl("https://$APP_HOST/assets/index.html")
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        printQueue.shutdown()
        webView.destroy()
        super.onDestroy()
    }

    /** Sends a result to the page: window.posNative.<name>(jsonString). */
    private fun callPage(name: String, json: JSONObject) {
        webView.evaluateJavascript("window.posNative && window.posNative.$name(${JSONObject.quote(json.toString())})", null)
    }

    // Android 12+ asks for "Nearby devices" before talking to paired Bluetooth devices.
    private fun withBluetooth(onDenied: () -> Unit, action: () -> Unit) {
        val needsAsk = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
        if (!needsAsk) {
            action()
            return
        }
        afterBluetoothPermission = { granted -> if (granted) action() else onDenied() }
        requestBluetooth.launch(Manifest.permission.BLUETOOTH_CONNECT)
    }

    fun capabilities(): String = JSONObject()
        .put("bluetooth", packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH))
        .put("scanner", true)
        .toString()

    fun listPrinters() {
        withBluetooth({ callPage("onPrinters", JSONObject().put("error", getString(R.string.bluetooth_denied))) }) {
            callPage("onPrinters", printer.pairedDevices())
        }
    }

    fun printBytes(address: String, base64: String) {
        val bytes = try {
            Base64.decode(base64, Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
            callPage("onPrintResult", JSONObject().put("ok", false).put("error", "Nothing to print"))
            return
        }
        withBluetooth({ callPage("onPrintResult", JSONObject().put("ok", false).put("error", getString(R.string.bluetooth_denied))) }) {
            printQueue.execute {
                val error = printer.print(address, bytes)
                runOnUiThread {
                    callPage("onPrintResult", JSONObject().put("ok", error == null).put("error", error ?: ""))
                }
            }
        }
    }

    // Google's code scanner runs in Google Play services, so the app needs no camera permission.
    fun scanBarcode(target: String) {
        GmsBarcodeScanning.getClient(this).startScan()
            .addOnSuccessListener { code ->
                callPage("onScan", JSONObject().put("target", target).put("value", code.rawValue ?: ""))
            }
            .addOnFailureListener {
                callPage("onScan", JSONObject().put("target", target).put("error", getString(R.string.scanner_unavailable)))
            }
    }

    fun saveFile(fileName: String, text: String, mimeType: String) {
        pendingSave = PendingSave(text)
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mimeType.ifBlank { "application/octet-stream" }
            putExtra(Intent.EXTRA_TITLE, fileName)
        }
        try {
            createFile.launch(intent)
        } catch (_: ActivityNotFoundException) {
            pendingSave = null
            toast(getString(R.string.file_save_failed))
        }
    }

    fun printPage() {
        val printManager = getSystemService(PRINT_SERVICE) as PrintManager
        val jobName = getString(R.string.print_job_name)
        printManager.print(jobName, webView.createPrintDocumentAdapter(jobName), PrintAttributes.Builder().build())
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_SHORT).show()

    companion object {
        const val APP_HOST = WebViewAssetLoader.DEFAULT_DOMAIN
    }
}
