package app.clonespace.profile

import java.security.SecureRandom
import kotlin.random.asKotlinRandom
import java.util.UUID

/** Builds internally consistent profiles from a [DeviceTemplate] and a [Region]. */
object ProfileGenerator {
    private val rng = SecureRandom()

    /**
     * @param realSdk Build.VERSION.SDK_INT of the running phone. The fingerprint is picked for this
     *   level so it agrees with the real OS version.
     * @param realRelease Build.VERSION.RELEASE of the running phone.
     */
    fun generate(
        realSdk: Int,
        realRelease: String,
        templateId: String? = null,
        regionCode: String? = null,
        avoidModel: String? = null,
        now: Long = System.currentTimeMillis(),
        /** Language tag and time zone to use instead of the region's defaults (see [forDevice]). */
        locale: String? = null,
        timezone: String? = null,
    ): DeviceProfile {
        val template = templateId?.let(Templates::byId)
            ?: Templates.all.filter { it.model != avoidModel }.random(rng.asKotlinRandom())
        val region = regionCode?.let(Templates::regionByCode) ?: Templates.regions.random(rng.asKotlinRandom())
        val operator = region.operators.random(rng.asKotlinRandom())
        val b = template.buildFor(realSdk)
        val fingerprint = "${template.brand}/${template.product}/${template.device}:" +
            "${b.release}/${b.buildId}/${b.incremental}:user/release-keys"
        val bootloader = if (template.vendor == "xiaomi") "unknown" else template.bootloaderPrefix + "-" + hex(3)

        return DeviceProfile(
            templateId = template.id, regionCode = region.code, locked = false, createdAt = now,
            androidId = hex(8),
            advertisingId = UUID.randomUUID().toString(),
            gsfId = hex(8),
            imei = imei(),
            imsi = operator.mccMnc + digits(15 - operator.mccMnc.length),
            simSerial = "89" + digits(17),
            wifiMac = mac(),
            wifiSsid = "Home_" + hex(2).uppercase(),
            serial = hex(5).uppercase(),
            simOperator = operator.mccMnc,
            simOperatorName = operator.name,
            simCountryIso = region.code.lowercase(),
            phoneType = 1,
            manufacturer = template.manufacturer, brand = template.brand, model = template.model,
            device = template.device, product = template.product, fingerprint = fingerprint,
            hardware = template.hardware, board = template.board, bootloader = bootloader,
            display = b.buildId + if (template.vendor == "samsung") "." + b.incremental else "",
            buildId = b.buildId, tags = "release-keys", type = "user",
            securityPatch = b.securityPatch,
            sdkInt = realSdk, release = realRelease,
            locale = locale ?: region.locale, timezone = timezone ?: region.timezone,
            densityDpi = template.densityDpi, widthPx = template.widthPx, heightPx = template.heightPx,
            spoofScreen = false,
            sensors = template.sensors,
        )
    }

    /**
     * Default profile for a new clone: a different device, but the language, country and time zone
     * the phone is really set to. A clone that suddenly speaks German from a Berlin time zone while
     * its network is in Miami is both unusable and far more suspicious than a second phone at home.
     */
    fun forDevice(realSdk: Int, realRelease: String, country: String, languageTag: String, timezone: String): DeviceProfile {
        val region = Templates.regionByCode(country.uppercase()) ?: Templates.regionByCode("US")!!
        return generate(realSdk, realRelease, null, region.code, null,
            locale = languageTag.ifBlank { region.locale }, timezone = timezone.ifBlank { region.timezone })
    }

    /** New identifiers, same device family, region, language and time zone. Used by "Regenerate". */
    fun regenerate(old: DeviceProfile, now: Long = System.currentTimeMillis()): DeviceProfile =
        generate(old.sdkInt, old.release, old.templateId, old.regionCode, null, now, old.locale, old.timezone)
            .copy(spoofScreen = old.spoofScreen)

    /** A completely different device in the same region, language and time zone. */
    fun reroll(old: DeviceProfile, now: Long = System.currentTimeMillis()): DeviceProfile =
        generate(old.sdkInt, old.release, null, old.regionCode, old.model, now, old.locale, old.timezone).copy(spoofScreen = old.spoofScreen)

    /** True when every vendor-specific and region-specific field agrees with the template and region. */
    fun isConsistent(p: DeviceProfile): Boolean {
        val t = Templates.byId(p.templateId) ?: return false
        val r = Templates.regionByCode(p.regionCode) ?: return false
        return p.brand == t.brand && p.manufacturer == t.manufacturer && p.model == t.model &&
            p.device == t.device && p.product == t.product && p.hardware == t.hardware &&
            p.board == t.board && p.fingerprint.startsWith("${t.brand}/${t.product}/${t.device}:") &&
            p.fingerprint.contains("/${p.buildId}/") &&
            p.locale.isNotBlank() && p.timezone.isNotBlank() &&
            p.simCountryIso == r.code.lowercase() &&
            r.operators.any { it.mccMnc == p.simOperator && it.name == p.simOperatorName } &&
            p.imsi.startsWith(p.simOperator) && isValidImei(p.imei)
    }

    private fun hex(bytes: Int): String {
        val b = ByteArray(bytes); rng.nextBytes(b)
        return b.joinToString("") { "%02x".format(it) }
    }

    private fun digits(n: Int): String = buildString { repeat(n) { append(rng.nextInt(10)) } }

    private fun mac(): String {
        val b = ByteArray(6); rng.nextBytes(b)
        b[0] = (b[0].toInt() and 0xFC).toByte()   // unicast, universally administered
        return b.joinToString(":") { "%02x".format(it) }
    }

    /** 15-digit IMEI: reporting body 35, random body, valid Luhn check digit. */
    fun imei(): String {
        val body = "35" + digits(12)
        return body + luhn(body)
    }

    fun luhn(body: String): Int {
        var sum = 0
        for ((i, ch) in body.reversed().withIndex()) {
            var d = ch - '0'
            if (i % 2 == 0) { d *= 2; if (d > 9) d -= 9 }
            sum += d
        }
        return (10 - sum % 10) % 10
    }

    fun isValidImei(s: String): Boolean =
        s.length == 15 && s.all { it.isDigit() } && luhn(s.substring(0, 14)) == s[14] - '0'
}
