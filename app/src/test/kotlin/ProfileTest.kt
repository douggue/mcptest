import app.clonespace.profile.*
import app.clonespace.proxy.*
import java.io.File
import kotlin.test.*

class ProfileTest {
    @Test fun everyTemplateAndRegionIsConsistent() {
        for (t in Templates.all) for (r in Templates.regions) for (sdk in listOf(34, 35, 36, 37)) {
            val p = ProfileGenerator.generate(sdk, "x", t.id, r.code)
            assertTrue(ProfileGenerator.isConsistent(p), "${t.id}/${r.code}/$sdk")
            assertTrue(p.fingerprint.contains(":${t.buildFor(sdk).release}/"))
            assertEquals(sdk, p.sdkInt)
            assertTrue(ProfileGenerator.isValidImei(p.imei))
            assertEquals(15, p.imsi.length)
            assertEquals(16, p.androidId.length)
        }
    }
    @Test fun regionAndPhonePresets() {
        // Regions: where TikTok's creator programmes run (rewards: US GB DE FR JP KR BR MX; the older fund: also IT ES).
        assertEquals(listOf("US", "GB", "DE", "FR", "JP", "KR", "BR", "MX", "IT", "ES"), Templates.regions.map { it.code })
        assertNull(Templates.regionByCode("IN"))
        for (r in Templates.regions) {
            assertTrue(r.operators.isNotEmpty() && r.operators.all { it.mccMnc.length in 5..6 && it.mccMnc.all(Char::isDigit) }, r.code)
            assertTrue(r.timezone in java.util.TimeZone.getAvailableIDs(), r.timezone)
            assertEquals(r.code, r.locale.substringAfter('-'))
        }
        // Phones: ids and models are unique, and every one has a build for a current Android.
        assertEquals(Templates.all.size, Templates.all.map { it.id }.toSet().size)
        assertEquals(Templates.all.size, Templates.all.map { it.model }.toSet().size)
        for (t in Templates.all) assertTrue(t.builds.keys.any { it >= 35 }, t.id)
        for (id in listOf("pixel10", "pixel10pro", "pixel9a", "galaxys25", "galaxys25ultra", "galaxys24ultra", "xiaomi14")) {
            assertNotNull(Templates.byId(id), id)
        }
    }
    @Test fun neverMixesVendors() {
        repeat(200) {
            val p = ProfileGenerator.generate(35, "15")
            val t = Templates.byId(p.templateId)!!
            assertEquals(t.vendor, Templates.all.first { it.model == p.model }.vendor)
            assertTrue(p.fingerprint.startsWith(t.brand + "/"))
        }
    }
    @Test fun clonesGetDifferentIds() {
        val ids = (1..50).map { ProfileGenerator.generate(35, "15").androidId }.toSet()
        assertEquals(50, ids.size)
    }
    @Test fun jsonRoundTrip() {
        val p = ProfileGenerator.generate(36, "16")
        assertEquals(p, DeviceProfile.fromJson(p.toJson()))
    }
    @Test fun storeLockRegenerateImportExport() {
        val dir = createTempDir()
        val s = ProfileStore(dir)
        val p = s.ensure(1, "com.whatsapp", 35, "15")
        assertEquals(p, s.ensure(1, "com.whatsapp", 35, "15"))
        val r = s.regenerate(1, "com.whatsapp")!!
        assertNotEquals(p.androidId, r.androidId); assertEquals(p.templateId, r.templateId)
        s.setLocked(1, "com.whatsapp", true)
        assertEquals(r.androidId, s.regenerate(1, "com.whatsapp")!!.androidId)
        val json = s.export(1, "com.whatsapp")!!
        val res = s.import(2, "com.whatsapp", json)
        assertTrue(res.isSuccess)
        val bad = org.json.JSONObject(json).put("model", "Pixel 99").toString()
        assertTrue(s.import(3, "com.whatsapp", bad).isFailure)
        assertNull(s.load(3, "com.whatsapp"))
        assertFailsWith<IllegalArgumentException> { s.load(1, "../evil") ; s.save(1, "../evil", p) }
    }
    @Test fun nativePropsCoverSpec() {
        val p = ProfileGenerator.generate(35, "15", "galaxys23", "DE")
        val m = ProfileMapper.systemProperties(p)
        assertEquals("SM-S911B", m["ro.product.model"]); assertEquals("SM-S911B", m["ro.product.vendor.model"])
        assertEquals(p.fingerprint, m["ro.build.fingerprint"])
        assertEquals(p.simOperator, m["gsm.sim.operator.numeric"]); assertTrue(p.simOperator in setOf("26201", "26202")); assertEquals("de", m["gsm.sim.operator.iso-country"])
        assertEquals("Europe/Berlin", m["persist.sys.timezone"])
        assertFalse(m.containsKey("ro.build.version.release")); assertFalse(m.containsKey("ro.build.version.sdk"))
        assertEquals(0, ProfileMapper.nativeArray(m).size % 2)
        assertEquals(p.androidId, ProfileMapper.identity(p)["android_id"])
    }
    @Test fun proxyStore() {
        val s = ProxyStore(createTempDir())
        assertFalse(s.load(0, "a.b").enabled)
        val c = ProxyConfig(true, ProxyType.HTTP, "10.0.0.1", 8080, "u", "p")
        s.save(0, "a.b", c); assertEquals(c, s.load(0, "a.b")); assertTrue(c.isUsable)
    }
}
