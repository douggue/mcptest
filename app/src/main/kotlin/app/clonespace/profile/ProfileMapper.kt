package app.clonespace.profile

/** Pure mapping from a [DeviceProfile] to what the engine layers need. No Android dependencies. */
object ProfileMapper {
    /** Keys read by the engine's IdentityStore (patch 0007). */
    fun identity(p: DeviceProfile): Map<String, String> = mapOf(
        "android_id" to p.androidId,
        "imei" to p.imei,
        "meid" to p.imei,
        "imsi" to p.imsi,
        "wifi_mac" to p.wifiMac,
        "wifi_bssid" to p.wifiMac,
        "wifi_ssid" to p.wifiSsid,
    )

    /** android.os.Build static fields. SDK_INT and RELEASE are deliberately absent. */
    fun buildFields(p: DeviceProfile): Map<String, String> = mapOf(
        "MANUFACTURER" to p.manufacturer, "BRAND" to p.brand, "MODEL" to p.model,
        "DEVICE" to p.device, "PRODUCT" to p.product, "FINGERPRINT" to p.fingerprint,
        "HARDWARE" to p.hardware, "BOARD" to p.board, "BOOTLOADER" to p.bootloader,
        "DISPLAY" to p.display, "ID" to p.buildId, "TAGS" to p.tags, "TYPE" to p.type,
        "SERIAL" to "unknown",
    )

    /** System properties served by the native __system_property_get / read_callback hook. */
    fun systemProperties(p: DeviceProfile): Map<String, String> {
        val m = LinkedHashMap<String, String>()
        // Android 10+ exposes product fields per partition as well as the unprefixed names.
        val parts = listOf("", "system.", "system_ext.", "vendor.", "odm.", "product.")
        for (part in parts) {
            m["ro.product.${part}model"] = p.model
            m["ro.product.${part}brand"] = p.brand
            m["ro.product.${part}manufacturer"] = p.manufacturer
            m["ro.product.${part}device"] = p.device
            m["ro.product.${part}name"] = p.product
        }
        for (part in listOf("", "system.", "system_ext.", "vendor.", "odm.", "product.", "bootimage.")) {
            m["ro.${part}build.fingerprint"] = p.fingerprint
            m["ro.${part}build.id"] = p.buildId
        }
        m["ro.build.display.id"] = p.display
        m["ro.build.tags"] = p.tags
        m["ro.build.type"] = p.type
        m["ro.build.version.security_patch"] = p.securityPatch
        m["ro.product.board"] = p.board
        m["ro.board.platform"] = Templates.byId(p.templateId)?.platform ?: p.board
        m["ro.hardware"] = p.hardware
        m["ro.boot.hardware"] = p.hardware
        m["ro.bootloader"] = p.bootloader
        m["ro.boot.bootloader"] = p.bootloader
        m["ro.serialno"] = p.serial
        m["ro.boot.serialno"] = p.serial
        m["gsm.sim.operator.numeric"] = p.simOperator
        m["gsm.operator.numeric"] = p.simOperator
        m["gsm.sim.operator.iso-country"] = p.simCountryIso
        m["gsm.operator.iso-country"] = p.simCountryIso
        m["gsm.sim.operator.alpha"] = p.simOperatorName
        m["gsm.operator.alpha"] = p.simOperatorName
        m["gsm.current.phone-type"] = p.phoneType.toString()
        m["persist.sys.timezone"] = p.timezone
        m["persist.sys.locale"] = p.locale
        m["ro.product.locale"] = p.locale
        if (p.spoofScreen) m["ro.sf.lcd_density"] = p.densityDpi.toString()
        return m
    }

    /** Flat [k0, v0, k1, v1, ...] array for NativeCore.configureSpoof. */
    fun nativeArray(props: Map<String, String>): Array<String> =
        props.entries.flatMap { listOf(it.key, it.value) }.toTypedArray()

    /** Substrings of /proc/self/maps lines that identify the container. */
    val mapsNeedles: List<String> = listOf("blackbox", "niunaijun", "dobby", "libxdl")

    /** Rewrites the Hardware / model lines of /proc/cpuinfo text to match the profile. */
    fun rewriteCpuInfo(real: String, p: DeviceProfile): String =
        real.lineSequence().joinToString("\n") { line ->
            when {
                line.startsWith("Hardware") -> "Hardware\t: ${p.hardware}"
                else -> line
            }
        }
}
