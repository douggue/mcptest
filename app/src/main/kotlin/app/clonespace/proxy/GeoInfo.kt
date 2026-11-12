package app.clonespace.proxy

import org.json.JSONObject
import java.util.Locale
import kotlin.math.cos

/** Where a proxy exits, as a public IP-location service reports it. */
data class GeoInfo(
    val ip: String,
    val country: String,      // ISO code, upper case
    val city: String,
    val latitude: Double,
    val longitude: Double,
    val timezone: String,     // IANA id
    /** Language tag for the country, e.g. "de-DE". */
    val locale: String,
) {
    val summary get() = listOf(city, country).filter { it.isNotBlank() }.joinToString(", ") + " · $timezone · $locale"

    fun toJson(): JSONObject = JSONObject().apply {
        put("ip", ip); put("country", country); put("city", city)
        put("latitude", latitude); put("longitude", longitude); put("timezone", timezone); put("locale", locale)
    }

    /**
     * IP-location services return one fixed point per city, the same for everyone. A clone standing
     * on exactly that point is easy to recognise, so move it by up to about 3 km. [r1] and [r2] are
     * random numbers in 0..1, chosen once so the clone does not jump on every start.
     */
    fun jittered(r1: Double, r2: Double): GeoInfo {
        val dLat = (r1 - 0.5) * 0.054
        val dLon = (r2 - 0.5) * 0.054 / cos(Math.toRadians(latitude)).coerceAtLeast(0.2)
        return copy(latitude = (latitude + dLat).coerceIn(-89.9, 89.9), longitude = longitude + dLon)
    }

    companion object {
        fun fromJson(o: JSONObject) = GeoInfo(
            o.optString("ip"), o.getString("country"), o.optString("city"),
            o.getDouble("latitude"), o.getDouble("longitude"), o.getString("timezone"), o.getString("locale"),
        )

        /**
         * Understands the replies of ipwho.is (timezone is an object), ipapi.co (timezone is a string)
         * and ipinfo.io (country code in "country", position as "lat,lon" in "loc").
         */
        fun parse(body: String): GeoInfo? = try {
            val o = JSONObject(body.substring(body.indexOf('{'), body.lastIndexOf('}') + 1))
            val tz = o.optJSONObject("timezone")?.optString("id") ?: o.optString("timezone")
            val country = o.optString("country_code").ifBlank { o.optString("country").takeIf { it.length == 2 }.orEmpty() }.uppercase()
            val loc = o.optString("loc").split(',').mapNotNull { it.trim().toDoubleOrNull() }.takeIf { it.size == 2 }
            val lat = if (o.has("latitude")) o.getDouble("latitude") else loc?.get(0)
            val lon = if (o.has("longitude")) o.getDouble("longitude") else loc?.get(1)
            if (o.has("success") && !o.optBoolean("success")) null
            else if (country.length != 2 || tz.isBlank() || lat == null || lon == null) null
            // An id Java does not know would silently become GMT in the clone.
            else if (tz !in java.util.TimeZone.getAvailableIDs()) null
            else GeoInfo(
                o.optString("ip"), country, o.optString("city"), lat, lon, tz,
                localeFor(country, o.optString("languages")),
            )
        } catch (_: Exception) {
            null
        }

        private val MAIN_LANGUAGE = mapOf(
            "US" to "en", "GB" to "en", "CA" to "en", "AU" to "en", "NZ" to "en", "IE" to "en", "ZA" to "en", "NG" to "en",
            "IN" to "en", "SG" to "en", "PH" to "en", "KE" to "en", "GH" to "en", "JM" to "en",
            "DE" to "de", "AT" to "de", "CH" to "de", "FR" to "fr", "BE" to "nl", "NL" to "nl", "LU" to "fr", "HT" to "fr",
            "ES" to "es", "MX" to "es", "AR" to "es", "CO" to "es", "CL" to "es", "PE" to "es", "VE" to "es", "DO" to "es",
            "EC" to "es", "GT" to "es", "CU" to "es", "PR" to "es",
            "BR" to "pt", "PT" to "pt", "IT" to "it", "PL" to "pl", "RO" to "ro", "CZ" to "cs", "HU" to "hu", "GR" to "el",
            "SE" to "sv", "NO" to "nb", "DK" to "da", "FI" to "fi", "RU" to "ru", "UA" to "uk", "TR" to "tr",
            "JP" to "ja", "KR" to "ko", "CN" to "zh", "TW" to "zh", "HK" to "zh", "VN" to "vi", "TH" to "th",
            "ID" to "id", "MY" to "ms", "PK" to "en", "BD" to "bn", "EG" to "ar", "SA" to "ar", "AE" to "ar", "MA" to "ar", "IL" to "he",
        )

        /** The country's main language: our table, then the service's own list, then English. */
        fun localeFor(country: String, serviceLanguages: String = ""): String {
            MAIN_LANGUAGE[country]?.let { return "$it-$country" }
            val first = serviceLanguages.split(',').firstOrNull()?.trim().orEmpty()
            if (first.isNotEmpty()) {
                val lang = Locale.forLanguageTag(first).language
                if (lang.isNotEmpty()) return "$lang-$country"
            }
            return "en-$country"
        }
    }
}
