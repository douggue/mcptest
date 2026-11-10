package app.clonespace.data

import app.clonespace.profile.DeviceProfile
import app.clonespace.proxy.ProxyConfig
import app.clonespace.shared.Keys

enum class LeakStatus { ISOLATED, LEAK, SHARED, UNKNOWN }

data class LeakRow(
    val key: String,
    val label: String,
    val real: String,
    val clone: String,
    val status: LeakStatus,
    val note: String? = null,
)

/**
 * Compares what the real phone returns with what the clone saw and with what the profile intended.
 * Pure function: nothing here touches Android, so it is unit-tested.
 */
object LeakAnalyzer {
    fun analyze(
        real: Map<String, String>,
        clone: Map<String, String>,
        profile: DeviceProfile,
        proxy: ProxyConfig,
    ): List<LeakRow> {
        val rows = ArrayList<LeakRow>()

        fun field(key: String, label: String, expected: String) {
            val r = real[key].orEmpty(); val c = clone[key]
            // An empty answer hides the real value but is not what the profile says; a phone with no
            // SIM operator or no model stands out, so it is reported instead of counted as isolated.
            val blank = c != null && c.isBlank() && expected.isNotBlank()
            val status = when {
                c == null -> LeakStatus.UNKNOWN
                c == r && c != expected -> LeakStatus.LEAK
                blank -> LeakStatus.UNKNOWN
                else -> LeakStatus.ISOLATED
            }
            rows += LeakRow(key, label, r, c ?: "no data", status,
                note = when {
                    blank -> "The clone got an empty value instead of the profile's ($expected)"
                    status == LeakStatus.ISOLATED && r == expected -> "Same as the real phone by coincidence"
                    else -> null
                })
        }

        field(Keys.ANDROID_ID, "Android ID", profile.androidId)
        field(Keys.MANUFACTURER, "Manufacturer", profile.manufacturer)
        field(Keys.BRAND, "Brand", profile.brand)
        field(Keys.MODEL, "Model", profile.model)
        field(Keys.DEVICE, "Device", profile.device)
        field(Keys.PRODUCT, "Product", profile.product)
        field(Keys.FINGERPRINT, "Build fingerprint", profile.fingerprint)
        field(Keys.HARDWARE, "Hardware", profile.hardware)
        field(Keys.BOARD, "Board", profile.board)
        field(Keys.BOOTLOADER, "Bootloader", profile.bootloader)
        field(Keys.DISPLAY, "Build display", profile.display)
        field(Keys.ID, "Build ID", profile.buildId)
        field(Keys.TAGS, "Build tags", profile.tags)
        field(Keys.TYPE, "Build type", profile.type)
        field(Keys.SECURITY_PATCH, "Security patch", profile.securityPatch)
        field(Keys.SIM_OPERATOR, "SIM operator", profile.simOperator)
        field(Keys.SIM_COUNTRY, "SIM country", profile.simCountryIso)
        field(Keys.SIM_OPERATOR_NAME, "SIM operator name", profile.simOperatorName)
        field(Keys.PHONE_TYPE, "Phone type", profile.phoneType.toString())
        field(Keys.WIFI_MAC, "Wi-Fi MAC", profile.wifiMac)
        field(Keys.LOCALE, "Locale", profile.locale)
        field(Keys.TIMEZONE, "Time zone", profile.timezone)
        field(Keys.PROP_MODEL, "Native property ro.product.model", profile.model)
        field(Keys.PROP_FINGERPRINT, "Native property ro.build.fingerprint", profile.fingerprint)
        field(Keys.PROP_SIM_OPERATOR, "Native property gsm.sim.operator.numeric", profile.simOperator)
        field(Keys.PROP_TIMEZONE, "Native property persist.sys.timezone", profile.timezone)
        val cpu = cpuInfoRow(real, clone)
        if (cpu != null) rows += cpu else field(Keys.CPUINFO_HARDWARE, "/proc/cpuinfo Hardware", profile.hardware)
        if (profile.spoofScreen) {
            field(Keys.DENSITY, "Screen density", profile.densityDpi.toString())
            field(Keys.WIDTH, "Screen width", profile.widthPx.toString())
            field(Keys.HEIGHT, "Screen height", profile.heightPx.toString())
        }

        // Things the container must not show.
        for ((key, label) in listOf(Keys.MAPS_CONTAINER to "Container in /proc/self/maps", Keys.STACK_CONTAINER to "Container in stack traces")) {
            val c = clone[key]
            rows += LeakRow(key, label, "n/a", c ?: "no data",
                when (c) { "visible" -> LeakStatus.LEAK; "hidden" -> LeakStatus.ISOLATED; else -> LeakStatus.UNKNOWN },
                note = if (key == Keys.STACK_CONTAINER && c == "visible") "Engine class names cannot be renamed yet (pending)" else null)
        }

        // Network.
        rows += ipRow(Keys.PUBLIC_IP, "Public IP (app traffic)", real, clone, proxy)
        rows += ipRow(Keys.WEBVIEW_IP, "Public IP (WebView traffic)", real, clone, proxy)
        val dns = clone[Keys.DNS]
        rows += LeakRow(Keys.DNS, "DNS lookup", real[Keys.DNS].orEmpty(), dns ?: "no data", when {
            dns == null -> LeakStatus.UNKNOWN
            !proxy.isUsable -> LeakStatus.SHARED
            dns.startsWith("198.18.") || dns.startsWith("198.19.") -> LeakStatus.ISOLATED
            else -> LeakStatus.LEAK
        }, note = if (!proxy.isUsable) "Proxy is off, so DNS goes out directly" else null)

        // Honest gaps: identifiers the engine cannot spoof yet.
        rows += LeakRow("advertising_id", "Advertising ID", "n/a", "n/a", LeakStatus.UNKNOWN,
            "Stored in the profile; applying it needs Google Play services hooks (pending)")
        rows += LeakRow("sensors", "Sensor list", "n/a", "n/a", LeakStatus.UNKNOWN,
            "Stored in the profile; no engine hook applies it yet (pending)")
        return rows
    }

    /**
     * Recent arm64 kernels (GKI: Pixel 6+, Galaxy S22+, ...) print no "Hardware" line in /proc/cpuinfo.
     * When the real phone has none and the clone has none, there is nothing that identifies the real
     * device, and inventing a line would make the clone look less like a real modern phone.
     */
    private fun cpuInfoRow(real: Map<String, String>, clone: Map<String, String>): LeakRow? {
        val r = real[Keys.CPUINFO_HARDWARE] ?: return null
        val c = clone[Keys.CPUINFO_HARDWARE] ?: return null
        if (r.isNotBlank() || c.isNotBlank()) return null
        return LeakRow(Keys.CPUINFO_HARDWARE, "/proc/cpuinfo Hardware", "none", "none", LeakStatus.ISOLATED,
            note = "This kernel has no Hardware line, so there is nothing to hide (normal on recent phones)")
    }

    private fun ipRow(key: String, label: String, real: Map<String, String>, clone: Map<String, String>, proxy: ProxyConfig): LeakRow {
        val r = real[Keys.PUBLIC_IP].orEmpty()
        val c = clone[key]
        val status = when {
            c == null -> LeakStatus.UNKNOWN
            !proxy.isUsable -> LeakStatus.SHARED
            c.isBlank() || c.startsWith("error") -> LeakStatus.UNKNOWN
            c == r -> LeakStatus.LEAK
            else -> LeakStatus.ISOLATED
        }
        return LeakRow(key, label, r, c ?: "no data", status,
            if (!proxy.isUsable) "Proxy is off, so the clone shares your real IP" else null)
    }

    fun summary(rows: List<LeakRow>): Triple<Int, Int, Int> =
        Triple(rows.count { it.status == LeakStatus.ISOLATED }, rows.count { it.status == LeakStatus.LEAK }, rows.count { it.status == LeakStatus.UNKNOWN || it.status == LeakStatus.SHARED })
}
