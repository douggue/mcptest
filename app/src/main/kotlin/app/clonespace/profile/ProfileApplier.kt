package app.clonespace.profile

import android.app.Activity
import android.app.Application
import android.content.ComponentCallbacks2
import android.content.res.Configuration
import android.content.res.Resources
import android.os.Build
import android.os.Bundle
import android.os.LocaleList
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
            setDefaultLocale(Locale.forLanguageTag(p.locale))
            TimeZone.setDefault(TimeZone.getTimeZone(p.timezone))
        }
    }

    /**
     * The framework calls LocaleList.setDefault(systemConfig.locales) every time it applies a configuration:
     * when an activity launches (pending config) and on every configuration change. That silently undoes
     * [applyLocaleAndTimezone]. Re-apply the profile locale after each of those points, before app code runs.
     */
    fun keepLocale(app: Application, p: DeviceProfile) {
        val locale = runCatching { Locale.forLanguageTag(p.locale) }.getOrNull() ?: return
        if (locale.language.isEmpty()) return
        val reapply = {
            setDefaultLocale(locale)
            if (TimeZone.getDefault().id != p.timezone) TimeZone.setDefault(TimeZone.getTimeZone(p.timezone))
        }
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            // Runs after ActivityThread applied the launch configuration and before Activity.onCreate.
            override fun onActivityPreCreated(activity: Activity, savedInstanceState: Bundle?) { reapply(); localize(activity.resources, locale, p) }
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) { reapply() }
            override fun onActivityStarted(activity: Activity) { reapply() }
            override fun onActivityResumed(activity: Activity) { reapply() }
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivityStopped(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
        app.registerComponentCallbacks(object : ComponentCallbacks2 {
            // Called after ResourcesManager has reset the default locale for the new configuration.
            override fun onConfigurationChanged(newConfig: Configuration) {
                reapply()
                localize(app.resources, locale, p)
            }
            @Suppress("OVERRIDE_DEPRECATION") override fun onLowMemory() {}
            override fun onTrimMemory(level: Int) {}
        })
        reapply()
    }

    private fun setDefaultLocale(locale: Locale) {
        if (Locale.getDefault() != locale) Locale.setDefault(locale)
        if (Build.VERSION.SDK_INT >= 24 && LocaleList.getDefault().let { it.size() != 1 || it[0] != locale }) {
            LocaleList.setDefault(LocaleList(locale))
        }
    }

    @Suppress("DEPRECATION")
    private fun localize(res: Resources, locale: Locale, p: DeviceProfile) {
        runCatching {
            if (res.configuration.locales[0] == locale && !p.spoofScreen) return
            val cfg = Configuration(res.configuration)
            cfg.setLocale(locale)
            if (Build.VERSION.SDK_INT >= 24) cfg.setLocales(LocaleList(locale))
            if (p.spoofScreen) cfg.densityDpi = p.densityDpi
            res.updateConfiguration(cfg, res.displayMetrics)
        }.onFailure { Log.w(TAG, "localize failed", it) }
    }

    /** Updates the framework's view of the locale for this process' resources. */
    @Suppress("DEPRECATION")
    fun applyResources(app: Application, p: DeviceProfile) {
        runCatching {
            val locale = Locale.forLanguageTag(p.locale)
            setDefaultLocale(locale)
            for (res in listOf(Resources.getSystem(), app.resources)) {
                val cfg = Configuration(res.configuration)
                cfg.setLocale(locale)
                if (Build.VERSION.SDK_INT >= 24) cfg.setLocales(LocaleList(locale))
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
