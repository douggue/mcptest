package app.clonespace.shared

import android.app.Application
import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.telephony.TelephonyManager
import java.io.File
import java.net.InetAddress
import java.net.URL
import java.util.Locale
import java.util.TimeZone
import javax.net.ssl.HttpsURLConnection

/** Reads what the current process sees. Used by the host (real values) and by the probe (clone view). */
object Collector {
    fun collectLocal(ctx: Context): LinkedHashMap<String, String> {
        val m = LinkedHashMap<String, String>()
        fun put(k: String, v: Any?) { m[k] = v?.toString() ?: "" }
        put(Keys.ANDROID_ID, runCatching { Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID) }.getOrNull())
        put(Keys.MODEL, Build.MODEL); put(Keys.MANUFACTURER, Build.MANUFACTURER); put(Keys.BRAND, Build.BRAND)
        put(Keys.DEVICE, Build.DEVICE); put(Keys.PRODUCT, Build.PRODUCT); put(Keys.FINGERPRINT, Build.FINGERPRINT)
        put(Keys.HARDWARE, Build.HARDWARE); put(Keys.BOARD, Build.BOARD); put(Keys.BOOTLOADER, Build.BOOTLOADER)
        put(Keys.DISPLAY, Build.DISPLAY); put(Keys.ID, Build.ID); put(Keys.TAGS, Build.TAGS); put(Keys.TYPE, Build.TYPE)
        put(Keys.SECURITY_PATCH, Build.VERSION.SECURITY_PATCH)
        put(Keys.SDK, Build.VERSION.SDK_INT); put(Keys.RELEASE, Build.VERSION.RELEASE)
        put(Keys.LOCALE, Locale.getDefault().toLanguageTag()); put(Keys.TIMEZONE, TimeZone.getDefault().id)
        val dm = ctx.resources.displayMetrics
        put(Keys.DENSITY, dm.densityDpi); put(Keys.WIDTH, dm.widthPixels); put(Keys.HEIGHT, dm.heightPixels)
        val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        put(Keys.SIM_OPERATOR, runCatching { tm?.simOperator }.getOrNull())
        put(Keys.SIM_COUNTRY, runCatching { tm?.simCountryIso }.getOrNull())
        put(Keys.SIM_OPERATOR_NAME, runCatching { tm?.simOperatorName }.getOrNull())
        put(Keys.PHONE_TYPE, runCatching { tm?.phoneType }.getOrNull())
        @Suppress("DEPRECATION")
        put(Keys.WIFI_MAC, runCatching {
            (ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager).connectionInfo.macAddress
        }.getOrNull())
        put(Keys.PROP_MODEL, sysProp("ro.product.model")); put(Keys.PROP_FINGERPRINT, sysProp("ro.build.fingerprint"))
        put(Keys.PROP_SIM_OPERATOR, sysProp("gsm.sim.operator.numeric")); put(Keys.PROP_TIMEZONE, sysProp("persist.sys.timezone"))
        put(Keys.CPUINFO_HARDWARE, cpuInfoHardware())
        put(Keys.MAPS_CONTAINER, if (mapsShowsContainer()) "visible" else "hidden")
        put(Keys.STACK_CONTAINER, if (stackShowsContainer()) "visible" else "hidden")
        put(Keys.PROCESS_NAME, if (Build.VERSION.SDK_INT >= 28) Application.getProcessName() else "")
        put(Keys.UID, Process.myUid()); put(Keys.PACKAGE, ctx.packageName); put(Keys.FILES_DIR, ctx.filesDir.absolutePath)
        return m
    }

    /** Blocking network checks. Call off the main thread. */
    fun collectNetwork(): LinkedHashMap<String, String> {
        val m = LinkedHashMap<String, String>()
        m[Keys.PUBLIC_IP] = runCatching { Trace.parseIp(httpsGet(Keys.TRACE_URL)) }.getOrElse { "error: ${it.javaClass.simpleName}" }
        m[Keys.DNS] = runCatching { InetAddress.getByName(Keys.DNS_TEST_HOST).hostAddress ?: "" }.getOrElse { "error: ${it.javaClass.simpleName}" }
        return m
    }

    private fun httpsGet(url: String): String {
        val c = URL(url).openConnection() as HttpsURLConnection
        c.connectTimeout = 10_000; c.readTimeout = 10_000
        return try { c.inputStream.bufferedReader().use { it.readText() } } finally { c.disconnect() }
    }

    private fun sysProp(name: String): String = try {
        Class.forName("android.os.SystemProperties").getMethod("get", String::class.java).invoke(null, name) as? String ?: ""
    } catch (_: Throwable) { "" }

    private fun cpuInfoHardware(): String = try {
        File("/proc/cpuinfo").useLines { l -> l.firstOrNull { it.startsWith("Hardware") }?.substringAfter(":")?.trim() ?: "" }
    } catch (_: Throwable) { "" }

    private val NEEDLES = listOf("blackbox", "niunaijun", "dobby")

    private fun mapsShowsContainer(): Boolean = try {
        File("/proc/self/maps").useLines { l -> l.any { line -> NEEDLES.any { line.contains(it, ignoreCase = true) } } }
    } catch (_: Throwable) { false }

    private fun stackShowsContainer(): Boolean =
        Throwable().stackTrace.any { e -> NEEDLES.any { e.className.contains(it, ignoreCase = true) } } ||
            Thread.currentThread().stackTrace.any { e -> NEEDLES.any { e.className.contains(it, ignoreCase = true) } }
}
