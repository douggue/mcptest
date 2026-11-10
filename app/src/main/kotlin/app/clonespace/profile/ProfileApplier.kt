package app.clonespace.profile

import android.app.Application
import android.content.res.Resources
import android.os.Build
import android.util.Log
import java.util.Locale
import java.util.TimeZone

/**
 * Java-level application of a [DeviceProfile] inside a clone process. Runs from the engine's
 * beforeCreateApplication / beforeApplicationOnCreate hooks, so it is in place before any code of the
 * target app runs. The engine-level pieces (Settings, telephony, native) live in VirtualEngine.
 */
object ProfileApplier {
    private const val TAG = "ProfileApplier"

    /** Sets android.os.Build static fields. Returns the names of fields that could not be set. */
    fun applyBuild(p: DeviceProfile): List<String> {
        val failed = ArrayList<String>()
        for ((name, value) in ProfileMapper.buildFields(p)) {
            if (!setStatic(Build::class.java, name, value)) failed += name
        }
        if (!setStatic(Build.VERSION::class.java, "SECURITY_PATCH", p.securityPatch)) failed += "SECURITY_PATCH"
        // SDK_INT and RELEASE are never changed: apps and the framework branch on them.
        if (failed.isNotEmpty()) Log.w(TAG, "Build fields not applied: $failed")
        return failed
    }

    fun applyLocaleAndTimezone(p: DeviceProfile) {
        runCatching {
            Locale.setDefault(Locale.forLanguageTag(p.locale))
            TimeZone.setDefault(TimeZone.getTimeZone(p.timezone))
        }
    }

    /** Updates the framework's view of the locale for this process' resources. */
    @Suppress("DEPRECATION")
    fun applyResources(app: Application, p: DeviceProfile) {
        runCatching {
            val locale = Locale.forLanguageTag(p.locale)
            for (res in listOf(Resources.getSystem(), app.resources)) {
                val cfg = android.content.res.Configuration(res.configuration)
                cfg.setLocale(locale)
                if (p.spoofScreen) cfg.densityDpi = p.densityDpi
                val dm = res.displayMetrics
                if (p.spoofScreen) {
                    dm.densityDpi = p.densityDpi
                    dm.density = p.densityDpi / 160f
                    dm.scaledDensity = dm.density
                    dm.widthPixels = p.widthPx
                    dm.heightPixels = p.heightPx
                }
                res.updateConfiguration(cfg, dm)
            }
        }.onFailure { Log.w(TAG, "applyResources failed", it) }
    }

    private fun setStatic(c: Class<*>, name: String, value: Any?): Boolean = try {
        val f = c.getDeclaredField(name)
        f.isAccessible = true
        f.set(null, value)
        true
    } catch (_: Throwable) {
        false
    }
}
