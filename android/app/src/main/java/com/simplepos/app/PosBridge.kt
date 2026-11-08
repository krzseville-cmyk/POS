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

    companion object {
        const val NAME = "AndroidPOS"
    }
}
