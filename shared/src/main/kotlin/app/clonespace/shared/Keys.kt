package app.clonespace.shared

/** Keys shared by the host app (real values) and the probe app (what a clone sees). */
object Keys {
    const val ANDROID_ID = "android_id"
    const val MODEL = "model"; const val MANUFACTURER = "manufacturer"; const val BRAND = "brand"
    const val DEVICE = "device"; const val PRODUCT = "product"; const val FINGERPRINT = "fingerprint"
    const val HARDWARE = "hardware"; const val BOARD = "board"; const val BOOTLOADER = "bootloader"
    const val DISPLAY = "display"; const val ID = "id"; const val TAGS = "tags"; const val TYPE = "type"
    const val SECURITY_PATCH = "security_patch"; const val SDK = "sdk"; const val RELEASE = "release"
    const val LOCALE = "locale"; const val TIMEZONE = "timezone"
    const val DENSITY = "density_dpi"; const val WIDTH = "width_px"; const val HEIGHT = "height_px"
    const val SIM_OPERATOR = "sim_operator"; const val SIM_COUNTRY = "sim_country"
    const val SIM_OPERATOR_NAME = "sim_operator_name"; const val PHONE_TYPE = "phone_type"
    const val WIFI_MAC = "wifi_mac"
    const val PROP_MODEL = "prop_model"; const val PROP_FINGERPRINT = "prop_fingerprint"
    const val PROP_SIM_OPERATOR = "prop_sim_operator"; const val PROP_TIMEZONE = "prop_timezone"
    const val CPUINFO_HARDWARE = "cpuinfo_hardware"
    const val MAPS_CONTAINER = "maps_container"   // "visible" or "hidden"
    const val STACK_CONTAINER = "stack_container" // "visible" or "hidden"
    const val PROCESS_NAME = "process_name"; const val UID = "uid"; const val PACKAGE = "package"
    const val FILES_DIR = "files_dir"
    const val PUBLIC_IP = "public_ip"; const val DNS = "dns_example"; const val WEBVIEW_IP = "webview_ip"
    const val TRACE_URL = "https://1.1.1.1/cdn-cgi/trace"
    const val DNS_TEST_HOST = "example.com"
}

object Trace {
    /** Extracts "ip=" from a Cloudflare /cdn-cgi/trace body. */
    fun parseIp(trace: String): String =
        trace.lineSequence().firstOrNull { it.startsWith("ip=") }?.removePrefix("ip=")?.trim().orEmpty()
}
