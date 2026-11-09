package com.simplepos.app

import android.webkit.JavascriptInterface

/**
 * Exposed to the page as `window.AndroidPOS`. The web app checks for it and uses these
 * instead of browser downloads and window.print(), which do nothing inside a WebView.
 * Calls arrive on a background thread, so each one is moved to the UI thread.
 */
class PosBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun saveFile(fileName: String, text: String, mimeType: String) {
        activity.runOnUiThread { activity.saveFile(fileName, text, mimeType) }
    }

    @JavascriptInterface
    fun print() {
        activity.runOnUiThread { activity.printPage() }
    }

    /** JSON: {"bluetooth": bool, "scanner": bool}. */
    @JavascriptInterface
    fun capabilities(): String = activity.capabilities()

    /** Result arrives via window.posNative.onPrinters. */
    @JavascriptInterface
    fun listPrinters() {
        activity.runOnUiThread { activity.listPrinters() }
    }

    /** ESC/POS bytes as base64; result arrives via window.posNative.onPrintResult. */
    @JavascriptInterface
    fun printBytes(address: String, base64: String) {
        activity.runOnUiThread { activity.printBytes(address, base64) }
    }

    /** Result arrives via window.posNative.onScan. */
    @JavascriptInterface
    fun scanBarcode(target: String) {
        activity.runOnUiThread { activity.scanBarcode(target) }
    }

    companion object {
        const val NAME = "AndroidPOS"
    }
}
