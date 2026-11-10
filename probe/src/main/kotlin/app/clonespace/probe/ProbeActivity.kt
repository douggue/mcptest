package app.clonespace.probe

import android.app.Activity
import android.graphics.Bitmap
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import app.clonespace.shared.Collector
import app.clonespace.shared.Keys
import app.clonespace.shared.Trace
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File

/**
 * Runs inside a clone. Collects what the clone sees (identifiers, properties, container traces, DNS,
 * public IP over plain HTTPS and over WebView) and writes files/result.json, which the host app reads
 * from the engine's virtual data directory. It contacts only the trace URL in Keys.TRACE_URL.
 */
class ProbeActivity : Activity() {
    private var finished = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val tv = TextView(this).apply { text = "CloneSpace probe\nCollecting…"; setPadding(48, 120, 48, 48); textSize = 16f }
        setContentView(tv)
        Thread {
            val data = Collector.collectLocal(this)
            data.putAll(Collector.collectNetwork())
            runOnUiThread { webCheck(data, tv) }
        }.start()
    }

    private fun webCheck(data: LinkedHashMap<String, String>, tv: TextView) {
        fun done(ip: String) {
            if (finished) return
            finished = true
            data[Keys.WEBVIEW_IP] = ip
            save(data)
            tv.text = "Done. You can return to CloneSpace."
        }
        try {
            val wv = WebView(this)
            wv.settings.javaScriptEnabled = true
            wv.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String?) {
                    view.evaluateJavascript("document.body.innerText") { raw ->
                        val text = runCatching { JSONTokener(raw).nextValue() as? String }.getOrNull().orEmpty()
                        done(Trace.parseIp(text).ifEmpty { "error: no ip in page" })
                    }
                }
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) done("error: ${error.description} (code ${error.errorCode})")
                }
                override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {}
            }
            wv.loadUrl(Keys.TRACE_URL)
            Handler(Looper.getMainLooper()).postDelayed({ done("error: timeout") }, 20_000)
        } catch (t: Throwable) {
            done("error: ${t.javaClass.simpleName}")
        }
    }

    private fun save(data: Map<String, String>) {
        val f = File(filesDir, "result.json")
        val tmp = File(filesDir, "result.json.tmp")
        tmp.writeText(JSONObject(data).toString())
        if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
    }
}
