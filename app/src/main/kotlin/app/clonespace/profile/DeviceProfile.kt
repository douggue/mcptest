package app.clonespace.profile

import org.json.JSONArray
import org.json.JSONObject

/**
 * One clone's identity. Everything here is generated, never read from the real phone, so the file
 * can be exported and shared without leaking anything about the real device.
 */
data class DeviceProfile(
    val templateId: String,
    val regionCode: String,
    val locked: Boolean,
    val createdAt: Long,

    // Settings and telephony
    val androidId: String,
    val advertisingId: String,
    val gsfId: String,
    val imei: String,
    val imsi: String,
    val simSerial: String,
    val wifiMac: String,
    val wifiSsid: String,
    val serial: String,
    val simOperator: String,       // MCC+MNC
    val simOperatorName: String,
    val simCountryIso: String,     // lower case
    val phoneType: Int,            // 1 = GSM

    // android.os.Build (strings are final per profile)
    val manufacturer: String,
    val brand: String,
    val model: String,
    val device: String,
    val product: String,
    val fingerprint: String,
    val hardware: String,
    val board: String,
    val bootloader: String,
    val display: String,
    val buildId: String,
    val tags: String,
    val type: String,
    val securityPatch: String,
    /** Recorded from the real OS when the profile was made. Never faked: apps branch on SDK_INT. */
    val sdkInt: Int,
    val release: String,

    // Locale and screen
    val locale: String,
    val timezone: String,
    val densityDpi: Int,
    val widthPx: Int,
    val heightPx: Int,
    /** Screen values change layout, so they only apply when this is true. Default off. */
    val spoofScreen: Boolean,

    val sensors: List<String>,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("version", 1)
        put("templateId", templateId); put("regionCode", regionCode); put("locked", locked)
        put("createdAt", createdAt)
        put("androidId", androidId); put("advertisingId", advertisingId); put("gsfId", gsfId)
        put("imei", imei); put("imsi", imsi); put("simSerial", simSerial)
        put("wifiMac", wifiMac); put("wifiSsid", wifiSsid); put("serial", serial)
        put("simOperator", simOperator); put("simOperatorName", simOperatorName)
        put("simCountryIso", simCountryIso); put("phoneType", phoneType)
        put("manufacturer", manufacturer); put("brand", brand); put("model", model)
        put("device", device); put("product", product); put("fingerprint", fingerprint)
        put("hardware", hardware); put("board", board); put("bootloader", bootloader)
        put("display", display); put("buildId", buildId); put("tags", tags); put("type", type)
        put("securityPatch", securityPatch); put("sdkInt", sdkInt); put("release", release)
        put("locale", locale); put("timezone", timezone); put("densityDpi", densityDpi)
        put("widthPx", widthPx); put("heightPx", heightPx); put("spoofScreen", spoofScreen)
        put("sensors", JSONArray(sensors))
    }

    companion object {
        fun fromJson(o: JSONObject): DeviceProfile {
            val s = o.optJSONArray("sensors")
            return DeviceProfile(
                templateId = o.getString("templateId"), regionCode = o.getString("regionCode"),
                locked = o.optBoolean("locked"), createdAt = o.optLong("createdAt"),
                androidId = o.getString("androidId"), advertisingId = o.getString("advertisingId"),
                gsfId = o.getString("gsfId"), imei = o.getString("imei"), imsi = o.getString("imsi"),
                simSerial = o.getString("simSerial"), wifiMac = o.getString("wifiMac"),
                wifiSsid = o.getString("wifiSsid"), serial = o.getString("serial"),
                simOperator = o.getString("simOperator"), simOperatorName = o.getString("simOperatorName"),
                simCountryIso = o.getString("simCountryIso"), phoneType = o.optInt("phoneType", 1),
                manufacturer = o.getString("manufacturer"), brand = o.getString("brand"),
                model = o.getString("model"), device = o.getString("device"),
                product = o.getString("product"), fingerprint = o.getString("fingerprint"),
                hardware = o.getString("hardware"), board = o.getString("board"),
                bootloader = o.getString("bootloader"), display = o.getString("display"),
                buildId = o.getString("buildId"), tags = o.getString("tags"), type = o.getString("type"),
                securityPatch = o.getString("securityPatch"), sdkInt = o.getInt("sdkInt"),
                release = o.getString("release"), locale = o.getString("locale"),
                timezone = o.getString("timezone"), densityDpi = o.getInt("densityDpi"),
                widthPx = o.getInt("widthPx"), heightPx = o.getInt("heightPx"),
                spoofScreen = o.optBoolean("spoofScreen"),
                sensors = (0 until (s?.length() ?: 0)).map { s!!.getString(it) },
            )
        }
    }
}
