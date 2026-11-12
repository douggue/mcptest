package app.clonespace.profile

/**
 * Device templates. One template is one real handset family, so Build fields, hardware strings,
 * screen and sensors always belong together (never mix vendors).
 *
 * SEED DATA: model, codename, product, hardware and board strings are the well-known values for each
 * handset. Per-release build ids and incremental numbers are best-effort and must be refreshed from
 * the vendors' factory images before release (see docs/research.md, open questions).
 */
data class BuildInfo(val release: String, val buildId: String, val incremental: String, val securityPatch: String)

data class DeviceTemplate(
    val id: String,
    val vendor: String,          // "google", "samsung", "xiaomi"
    val brand: String,
    val manufacturer: String,
    val model: String,
    val device: String,
    val product: String,
    val hardware: String,
    val board: String,
    val platform: String,
    val bootloaderPrefix: String,
    val densityDpi: Int,
    val widthPx: Int,
    val heightPx: Int,
    val sensors: List<String>,
    /** Keyed by Android SDK level (34, 35, 36). */
    val builds: Map<Int, BuildInfo>,
) {
    /** The entry closest to the running device's SDK level, so the fingerprint matches the real OS. */
    fun buildFor(sdk: Int): BuildInfo {
        builds[sdk]?.let { return it }
        val key = builds.keys.sorted().let { ks -> ks.lastOrNull { it <= sdk } ?: ks.first() }
        return builds.getValue(key)
    }
}

data class Region(
    val code: String,
    val locale: String,
    val timezone: String,
    val operators: List<Operator>,
)

data class Operator(val mccMnc: String, val name: String)

object Templates {
    private fun pixelSensors(imu: String, mag: String) = listOf(
        "$imu Accelerometer", "$imu Gyroscope", "$mag Magnetometer",
        "TCS3701 Light Sensor", "Proximity Sensor", "BMP580 Pressure Sensor",
        "Gravity Sensor", "Linear Acceleration Sensor", "Rotation Vector Sensor", "Step Counter",
    )

    private fun samsungSensors(imu: String, mag: String) = listOf(
        "$imu Accelerometer", "$imu Gyroscope", "$mag Magnetic Sensor",
        "Light Sensor", "Proximity Sensor", "Pressure Sensor",
        "Gravity Sensor", "Linear Acceleration Sensor", "Rotation Vector", "Step Counter",
    )

    val all: List<DeviceTemplate> = listOf(
        DeviceTemplate(
            id = "pixel7", vendor = "google", brand = "google", manufacturer = "Google",
            model = "Pixel 7", device = "panther", product = "panther", hardware = "panther",
            board = "panther", platform = "gs201", bootloaderPrefix = "cloudripper",
            densityDpi = 420, widthPx = 1080, heightPx = 2400,
            sensors = pixelSensors("LSM6DSV", "AK09918"),
            builds = mapOf(
                34 to BuildInfo("14", "UP1A.231105.001", "10817346", "2023-11-05"),
                35 to BuildInfo("15", "AP4A.250205.002", "12932599", "2025-02-05"),
                36 to BuildInfo("16", "BP2A.250605.031.A2", "13578787", "2025-06-05"),
            ),
        ),
        DeviceTemplate(
            id = "pixel8", vendor = "google", brand = "google", manufacturer = "Google",
            model = "Pixel 8", device = "shiba", product = "shiba", hardware = "shiba",
            board = "shiba", platform = "zuma", bootloaderPrefix = "ripcurrent",
            densityDpi = 420, widthPx = 1080, heightPx = 2400,
            sensors = pixelSensors("LSM6DSV", "AK09918"),
            builds = mapOf(
                34 to BuildInfo("14", "UQ1A.240205.002", "11224170", "2024-02-05"),
                35 to BuildInfo("15", "AP4A.250205.002", "12932599", "2025-02-05"),
                36 to BuildInfo("16", "BP2A.250605.031.A2", "13578787", "2025-06-05"),
            ),
        ),
        DeviceTemplate(
            id = "pixel9", vendor = "google", brand = "google", manufacturer = "Google",
            model = "Pixel 9", device = "tokay", product = "tokay", hardware = "tokay",
            board = "tokay", platform = "zumapro", bootloaderPrefix = "tokay",
            densityDpi = 420, widthPx = 1080, heightPx = 2424,
            sensors = pixelSensors("LSM6DSV", "AK09918"),
            builds = mapOf(
                34 to BuildInfo("14", "AD1A.240905.004", "12231197", "2024-09-05"),
                35 to BuildInfo("15", "AP4A.250205.002", "12932599", "2025-02-05"),
                36 to BuildInfo("16", "BP2A.250605.031.A2", "13578787", "2025-06-05"),
            ),
        ),
        DeviceTemplate(
            id = "pixel8pro", vendor = "google", brand = "google", manufacturer = "Google",
            model = "Pixel 8 Pro", device = "husky", product = "husky", hardware = "husky",
            board = "husky", platform = "zuma", bootloaderPrefix = "ripcurrent",
            densityDpi = 480, widthPx = 1344, heightPx = 2992,
            sensors = pixelSensors("LSM6DSV", "AK09918"),
            builds = mapOf(
                34 to BuildInfo("14", "UQ1A.240205.002", "11224170", "2024-02-05"),
                35 to BuildInfo("15", "AP4A.250205.002", "12932599", "2025-02-05"),
                36 to BuildInfo("16", "BP2A.250605.031.A2", "13578787", "2025-06-05"),
            ),
        ),
        DeviceTemplate(
            id = "pixel8a", vendor = "google", brand = "google", manufacturer = "Google",
            model = "Pixel 8a", device = "akita", product = "akita", hardware = "akita",
            board = "akita", platform = "zuma", bootloaderPrefix = "akita",
            densityDpi = 420, widthPx = 1080, heightPx = 2400,
            sensors = pixelSensors("LSM6DSV", "AK09918"),
            builds = mapOf(
                34 to BuildInfo("14", "AP2A.240805.005", "12025142", "2024-08-05"),
                35 to BuildInfo("15", "AP4A.250205.002", "12932599", "2025-02-05"),
                36 to BuildInfo("16", "BP2A.250605.031.A2", "13578787", "2025-06-05"),
            ),
        ),
        DeviceTemplate(
            id = "pixel9pro", vendor = "google", brand = "google", manufacturer = "Google",
            model = "Pixel 9 Pro", device = "caiman", product = "caiman", hardware = "caiman",
            board = "caiman", platform = "zumapro", bootloaderPrefix = "ripcurrentpro",
            densityDpi = 480, widthPx = 1280, heightPx = 2856,
            sensors = pixelSensors("LSM6DSV", "AK09918"),
            builds = mapOf(
                34 to BuildInfo("14", "AD1A.240905.004", "12231197", "2024-09-05"),
                35 to BuildInfo("15", "AP4A.250205.002", "12932599", "2025-02-05"),
                36 to BuildInfo("16", "BP2A.250605.031.A2", "13578787", "2025-06-05"),
            ),
        ),
        DeviceTemplate(
            id = "pixel9proxl", vendor = "google", brand = "google", manufacturer = "Google",
            model = "Pixel 9 Pro XL", device = "komodo", product = "komodo", hardware = "komodo",
            board = "komodo", platform = "zumapro", bootloaderPrefix = "ripcurrentpro",
            densityDpi = 480, widthPx = 1344, heightPx = 2992,
            sensors = pixelSensors("LSM6DSV", "AK09918"),
            builds = mapOf(
                34 to BuildInfo("14", "AD1A.240905.004", "12231197", "2024-09-05"),
                35 to BuildInfo("15", "AP4A.250205.002", "12932599", "2025-02-05"),
                36 to BuildInfo("16", "BP2A.250605.031.A2", "13578787", "2025-06-05"),
            ),
        ),
        // Shipped with Android 15: there is no Android 14 build.
        DeviceTemplate(
            id = "pixel9a", vendor = "google", brand = "google", manufacturer = "Google",
            model = "Pixel 9a", device = "tegu", product = "tegu", hardware = "tegu",
            board = "tegu", platform = "zumapro", bootloaderPrefix = "tegu",
            densityDpi = 420, widthPx = 1080, heightPx = 2424,
            sensors = pixelSensors("LSM6DSV", "AK09918"),
            builds = mapOf(
                35 to BuildInfo("15", "BD4A.250405.003", "13238919", "2025-04-05"),
                36 to BuildInfo("16", "BP2A.250605.031.A2", "13578787", "2025-06-05"),
            ),
        ),
        // The Pixel 10 family shipped with Android 16 (build BD3A.250721.001, August 2025).
        DeviceTemplate(
            id = "pixel10", vendor = "google", brand = "google", manufacturer = "Google",
            model = "Pixel 10", device = "frankel", product = "frankel", hardware = "frankel",
            board = "frankel", platform = "laguna", bootloaderPrefix = "frankel",
            densityDpi = 420, widthPx = 1080, heightPx = 2424,
            sensors = pixelSensors("LSM6DSV", "AK09918"),
            builds = mapOf(36 to BuildInfo("16", "BD3A.250721.001", "13846583", "2025-08-05")),
        ),
        DeviceTemplate(
            id = "pixel10pro", vendor = "google", brand = "google", manufacturer = "Google",
            model = "Pixel 10 Pro", device = "blazer", product = "blazer", hardware = "blazer",
            board = "blazer", platform = "laguna", bootloaderPrefix = "blazer",
            densityDpi = 480, widthPx = 1280, heightPx = 2856,
            sensors = pixelSensors("LSM6DSV", "AK09918"),
            builds = mapOf(36 to BuildInfo("16", "BD3A.250721.001", "13846583", "2025-08-05")),
        ),
        DeviceTemplate(
            id = "pixel10proxl", vendor = "google", brand = "google", manufacturer = "Google",
            model = "Pixel 10 Pro XL", device = "mustang", product = "mustang", hardware = "mustang",
            board = "mustang", platform = "laguna", bootloaderPrefix = "mustang",
            densityDpi = 480, widthPx = 1344, heightPx = 2992,
            sensors = pixelSensors("LSM6DSV", "AK09918"),
            builds = mapOf(36 to BuildInfo("16", "BD3A.250721.001", "13846583", "2025-08-05")),
        ),
        DeviceTemplate(
            id = "galaxys23", vendor = "samsung", brand = "samsung", manufacturer = "samsung",
            model = "SM-S911B", device = "dm1q", product = "dm1qxx", hardware = "qcom",
            board = "kalama", platform = "kalama", bootloaderPrefix = "S911BXXU",
            densityDpi = 480, widthPx = 1080, heightPx = 2340,
            sensors = samsungSensors("LSM6DSO", "AK09918C"),
            builds = mapOf(
                34 to BuildInfo("14", "UP1A.231005.007", "S911BXXU3CXA1", "2024-01-01"),
                35 to BuildInfo("15", "AP3A.240905.015.A2", "S911BXXU5DYA1", "2025-01-01"),
                36 to BuildInfo("16", "BP2A.250605.031.A3", "S911BXXU6EYF1", "2025-06-01"),
            ),
        ),
        DeviceTemplate(
            id = "galaxya54", vendor = "samsung", brand = "samsung", manufacturer = "samsung",
            model = "SM-A546B", device = "a54x", product = "a54xnsxx", hardware = "exynos1380",
            board = "s5e8535", platform = "exynos1380", bootloaderPrefix = "A546BXXU",
            densityDpi = 450, widthPx = 1080, heightPx = 2340,
            sensors = samsungSensors("LSM6DSL", "YAS539"),
            builds = mapOf(
                34 to BuildInfo("14", "UP1A.231005.007", "A546BXXS8EXA1", "2024-01-01"),
                35 to BuildInfo("15", "AP3A.240905.015.A2", "A546BXXS9FYA1", "2025-01-01"),
                36 to BuildInfo("16", "BP2A.250605.031.A3", "A546BXXSAFYF1", "2025-06-01"),
            ),
        ),
        DeviceTemplate(
            id = "galaxys24ultra", vendor = "samsung", brand = "samsung", manufacturer = "samsung",
            model = "SM-S928B", device = "e3q", product = "e3qxxx", hardware = "qcom",
            board = "pineapple", platform = "pineapple", bootloaderPrefix = "S928BXXU",
            densityDpi = 450, widthPx = 1080, heightPx = 2340,
            sensors = samsungSensors("LSM6DSV", "AK09918C"),
            builds = mapOf(
                34 to BuildInfo("14", "UP1A.231005.007", "S928BXXU1AXB5", "2024-02-01"),
                35 to BuildInfo("15", "AP3A.240905.015.A2", "S928BXXU4BYD9", "2025-04-01"),
                36 to BuildInfo("16", "BP2A.250605.031.A3", "S928BXXU5CYI7", "2025-09-01"),
            ),
        ),
        // The Galaxy S25 family shipped with Android 15: there is no Android 14 build.
        DeviceTemplate(
            id = "galaxys25", vendor = "samsung", brand = "samsung", manufacturer = "samsung",
            model = "SM-S931B", device = "pa1q", product = "pa1qxxx", hardware = "qcom",
            board = "sun", platform = "sun", bootloaderPrefix = "S931BXXU",
            densityDpi = 480, widthPx = 1080, heightPx = 2340,
            sensors = samsungSensors("LSM6DSV", "AK09918C"),
            builds = mapOf(
                35 to BuildInfo("15", "AP3A.240905.015.A2", "S931BXXU1AYA1", "2025-01-01"),
                36 to BuildInfo("16", "BP2A.250605.031.A3", "S931BXXU5BYI3", "2025-09-01"),
            ),
        ),
        DeviceTemplate(
            id = "galaxys25ultra", vendor = "samsung", brand = "samsung", manufacturer = "samsung",
            model = "SM-S938B", device = "pa3q", product = "pa3qxxx", hardware = "qcom",
            board = "sun", platform = "sun", bootloaderPrefix = "S938BXXU",
            densityDpi = 450, widthPx = 1080, heightPx = 2340,
            sensors = samsungSensors("LSM6DSV", "AK09918C"),
            builds = mapOf(
                35 to BuildInfo("15", "AP3A.240905.015.A2", "S938BXXU1AYA1", "2025-01-01"),
                36 to BuildInfo("16", "BP2A.250605.031.A3", "S938BXXU5BYI3", "2025-09-01"),
            ),
        ),
        DeviceTemplate(
            id = "galaxya55", vendor = "samsung", brand = "samsung", manufacturer = "samsung",
            model = "SM-A556B", device = "a55x", product = "a55xnsxx", hardware = "exynos1480",
            board = "s5e8845", platform = "exynos1480", bootloaderPrefix = "A556BXXU",
            densityDpi = 450, widthPx = 1080, heightPx = 2340,
            sensors = samsungSensors("LSM6DSV", "AK09918C"),
            builds = mapOf(
                34 to BuildInfo("14", "UP1A.231005.007", "A556BXXU1AXC1", "2024-03-01"),
                35 to BuildInfo("15", "AP3A.240905.015.A2", "A556BXXU8BYD1", "2025-04-01"),
                36 to BuildInfo("16", "BP2A.250605.031.A3", "A556BXXUACYI1", "2025-09-01"),
            ),
        ),
        DeviceTemplate(
            id = "xiaomi14", vendor = "xiaomi", brand = "Xiaomi", manufacturer = "Xiaomi",
            model = "23127PN0CG", device = "houji", product = "houji_global", hardware = "qcom",
            board = "pineapple", platform = "pineapple", bootloaderPrefix = "unknown",
            densityDpi = 460, widthPx = 1200, heightPx = 2670,
            sensors = listOf(
                "BMI323 Accelerometer", "BMI323 Gyroscope", "MMC56x3x Magnetometer",
                "STK3A5X Light Sensor", "STK3A5X Proximity Sensor", "Gravity Sensor",
                "Linear Acceleration Sensor", "Rotation Vector Sensor", "Step Counter",
            ),
            builds = mapOf(
                34 to BuildInfo("14", "UKQ1.230804.001", "V816.0.5.0.UNCMIXM", "2024-03-01"),
                35 to BuildInfo("15", "AP3A.240617.008", "OS2.0.4.0.VNCMIXM", "2025-01-01"),
                36 to BuildInfo("16", "BP2A.250605.031", "OS3.0.2.0.WNCMIXM", "2025-06-01"),
            ),
        ),
        DeviceTemplate(
            id = "xiaomi13", vendor = "xiaomi", brand = "Xiaomi", manufacturer = "Xiaomi",
            model = "2211133G", device = "fuxi", product = "fuxi_global", hardware = "qcom",
            board = "kalama", platform = "kalama", bootloaderPrefix = "unknown",
            densityDpi = 440, widthPx = 1080, heightPx = 2400,
            sensors = listOf(
                "BMI323 Accelerometer", "BMI323 Gyroscope", "MMC56x3x Magnetometer",
                "STK3A5X Light Sensor", "STK3A5X Proximity Sensor", "Gravity Sensor",
                "Linear Acceleration Sensor", "Rotation Vector Sensor", "Step Counter",
            ),
            builds = mapOf(
                34 to BuildInfo("14", "UKQ1.230804.001", "V816.0.9.0.UMCMIXM", "2024-03-01"),
                35 to BuildInfo("15", "AP3A.240617.008", "OS2.0.10.0.VMCMIXM", "2025-01-01"),
                36 to BuildInfo("16", "BP2A.250605.031", "OS3.0.1.0.WMCMIXM", "2025-06-01"),
            ),
        ),
    )

    fun byId(id: String): DeviceTemplate? = all.firstOrNull { it.id == id }

    val regions: List<Region> = listOf(
        Region("US", "en-US", "America/New_York", listOf(Operator("310260", "T-Mobile"), Operator("311480", "Verizon"), Operator("310410", "AT&T"))),
        Region("GB", "en-GB", "Europe/London", listOf(Operator("23430", "EE"), Operator("23415", "Vodafone UK"))),
        Region("DE", "de-DE", "Europe/Berlin", listOf(Operator("26201", "Telekom.de"), Operator("26202", "Vodafone.de"))),
        Region("FR", "fr-FR", "Europe/Paris", listOf(Operator("20801", "Orange F"), Operator("20810", "SFR"))),
        Region("JP", "ja-JP", "Asia/Tokyo", listOf(Operator("44010", "NTT DOCOMO"), Operator("44020", "SoftBank"), Operator("44050", "au"))),
        Region("KR", "ko-KR", "Asia/Seoul", listOf(Operator("45005", "SKTelecom"), Operator("45008", "KT"), Operator("45006", "LG U+"))),
        Region("BR", "pt-BR", "America/Sao_Paulo", listOf(Operator("72406", "VIVO"), Operator("72405", "Claro BR"))),
        Region("MX", "es-MX", "America/Mexico_City", listOf(Operator("33402", "Telcel"), Operator("334050", "AT&T MX"))),
        Region("IT", "it-IT", "Europe/Rome", listOf(Operator("22201", "TIM"), Operator("22210", "vodafone IT"), Operator("22288", "WINDTRE"))),
        Region("ES", "es-ES", "Europe/Madrid", listOf(Operator("21407", "Movistar"), Operator("21401", "vodafone ES"))),
    )

    fun regionByCode(code: String): Region? = regions.firstOrNull { it.code == code }
}
