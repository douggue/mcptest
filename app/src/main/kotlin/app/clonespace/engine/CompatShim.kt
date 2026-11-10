package app.clonespace.engine

import android.app.PendingIntent
import android.util.Log
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Proxy

/**
 * Turns off one framework compatibility check inside clone processes.
 *
 * Android throws IllegalArgumentException when an app that targets Android 12+ creates a
 * PendingIntent with neither FLAG_IMMUTABLE nor FLAG_MUTABLE. Apps carry old fallback code that
 * still does this and normally never runs: Facebook's Firebase fallback for a phone without Google
 * Play services is one. Inside a clone, Google Play services are usually not visible, the fallback
 * runs, and the app dies at start. The check is a client-side lint, not a security boundary (the
 * system still treats such a PendingIntent as mutable, as it did before Android 12), so it is
 * switched off for the clone only. Every other compatibility change is passed through untouched.
 */
object CompatShim {
    private const val TAG = "CompatShim"

    fun install() {
        try {
            val changeId = runCatching {
                PendingIntent::class.java.getDeclaredField("PENDING_INTENT_EXPLICIT_MUTABILITY_REQUIRED").apply { isAccessible = true }.getLong(null)
            }.getOrDefault(160794467L)
            val compat = Class.forName("android.compat.Compatibility")
            val delegateType = Class.forName("android.compat.Compatibility\$BehaviorChangeDelegate")
            val field = compat.getDeclaredField("sCallbacks").apply { isAccessible = true }
            val original = field.get(null) ?: return
            if (Proxy.isProxyClass(original.javaClass)) return   // already installed in this process
            val shim = Proxy.newProxyInstance(delegateType.classLoader, arrayOf(delegateType)) { _, method, args ->
                if (method.name == "isChangeEnabled" && args != null && args.size == 1 && args[0] == changeId) {
                    false
                } else {
                    try {
                        method.invoke(original, *(args ?: emptyArray()))
                    } catch (e: InvocationTargetException) {
                        throw e.targetException
                    }
                }
            }
            compat.getMethod("setBehaviorChangeDelegate", delegateType).invoke(null, shim)
        } catch (t: Throwable) {
            Log.w(TAG, "not installed: $t")
        }
    }
}
