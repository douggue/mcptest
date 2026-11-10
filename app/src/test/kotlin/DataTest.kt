import app.clonespace.data.*
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.test.*

class DataTest {
    @Test fun healthTracksLaunchAndCrashes() {
        val h = HealthStore(createTempDir())
        assertEquals(Health.NONE, h.read(1, "a.b"))
        h.recordLaunch(1, "a.b", true, 10); h.recordCrash(1, "a.b", "boom\nx", 20); h.recordCrash(1, "a.b", null, 30)
        var r = h.read(1, "a.b"); assertEquals(true, r.lastLaunchOk); assertEquals(2, r.crashes); assertTrue(r.isDegraded)
        h.recordLaunch(1, "a.b", false, 40)
        r = h.read(1, "a.b"); assertEquals(false, r.lastLaunchOk); assertEquals(0, r.crashes); assertTrue(r.isDegraded)
        repeat(300) { h.recordLaunch(1, "a.b", true, it.toLong()) }; h.trim(1, "a.b"); assertTrue(h.read(1, "a.b").lastLaunchOk == true)
    }
    @Test fun metaStore() {
        val f = File(createTempDir(), "m.json"); val m = MetaStore(f)
        assertEquals(0, m.addSpace().id); assertEquals(1, m.addSpace("Work").id)
        m.adopt(listOf(0, 1, 5)); assertEquals(listOf(0, 1, 5), m.spaces().map { it.id })
        m.setMeta(1, "a.b", CloneMeta("Biz", 0xFF112233.toInt(), "Work WA"))
        val m2 = MetaStore(f); assertEquals("Work", m2.spaceName(1)); assertEquals("Biz", m2.meta(1, "a.b").customName)
        assertEquals("Work WA", m2.meta(1, "a.b").notificationLabel); assertEquals(0xFF112233.toInt(), m2.meta(1, "a.b").badgeColor)
        m2.removeSpace(1); assertEquals(CloneMeta(), m2.meta(1, "a.b"))
    }
    @Test fun backupRoundTripAndRefusesWrongPackage() {
        val base = createTempDir(); val d0 = File(base, "u/x").apply { mkdirs() }; val d1 = File(base, "de/x").apply { mkdirs() }
        File(d0, "files").mkdirs(); File(d0, "files/a.txt").writeText("hello"); File(d0, "db.sqlite").writeBytes(ByteArray(5000) { it.toByte() }); File(d1, "k").writeText("de")
        val out = ByteArrayOutputStream()
        BackupManager.backup(out, "com.x.y", 2, listOf(d0, d1), "{\"a\":1}")
        File(d0, "files/a.txt").writeText("CHANGED"); File(d0, "extra").writeText("gone")
        val r = BackupManager.restore(ByteArrayInputStream(out.toByteArray()), "com.x.y", listOf(d0, d1), File(base, "stage"))
        assertTrue(r.isSuccess, r.exceptionOrNull()?.toString())
        assertEquals("hello", File(d0, "files/a.txt").readText()); assertFalse(File(d0, "extra").exists()); assertEquals("de", File(d1, "k").readText())
        assertEquals(5000, File(d0, "db.sqlite").length())
        assertTrue(BackupManager.restore(ByteArrayInputStream(out.toByteArray()), "other.pkg", listOf(d0, d1), File(base, "stage")).isFailure)
        assertEquals("hello", File(d0, "files/a.txt").readText())   // refusal left data alone
    }
    @Test fun restoreRejectsZipSlip() {
        val base = createTempDir(); val d0 = File(base, "u").apply { mkdirs() }; File(d0, "keep").writeText("1")
        val bad = ByteArrayOutputStream()
        ZipOutputStream(bad).use { z ->
            z.putNextEntry(ZipEntry("manifest.json")); z.write("{\"pkg\":\"a.b\"}".toByteArray()); z.closeEntry()
            z.putNextEntry(ZipEntry("d0/../../evil.txt")); z.write("x".toByteArray()); z.closeEntry()
        }
        val r = BackupManager.restore(ByteArrayInputStream(bad.toByteArray()), "a.b", listOf(d0), File(base, "stage"))
        assertTrue(r.isFailure); assertFalse(File(base, "evil.txt").exists()); assertEquals("1", File(d0, "keep").readText())
    }
}

class GeoTest {
    @Test fun parsesBothServices() {
        val a = app.clonespace.proxy.GeoInfo.parse("HTTP/1.1 200 OK\r\n\r\n{\"ip\":\"8.8.8.8\",\"success\":true,\"country_code\":\"US\",\"city\":\"San Jose\",\"latitude\":37.33,\"longitude\":-121.89,\"timezone\":{\"id\":\"America/Los_Angeles\",\"utc\":\"-08:00\"}}")!!
        assertEquals("America/Los_Angeles", a.timezone); assertEquals("en-US", a.locale); assertEquals(37.33, a.latitude)
        val b = app.clonespace.proxy.GeoInfo.parse("{\"ip\":\"1.2.3.4\",\"country_code\":\"DE\",\"city\":\"Berlin\",\"latitude\":52.5,\"longitude\":13.4,\"timezone\":\"Europe/Berlin\",\"languages\":\"de\"}")!!
        assertEquals("de-DE", b.locale); assertEquals("Europe/Berlin", b.timezone)
        assertNull(app.clonespace.proxy.GeoInfo.parse("{\"success\":false,\"message\":\"limit\"}"))
        assertNull(app.clonespace.proxy.GeoInfo.parse("<html>blocked</html>"))
        assertEquals("sw-TZ", app.clonespace.proxy.GeoInfo.localeFor("TZ", "sw-TZ,en"))
        assertEquals("en-ZZ", app.clonespace.proxy.GeoInfo.localeFor("ZZ"))
    }
    @Test fun jitterStaysCloseAndRoundTrips() {
        val g = app.clonespace.proxy.GeoInfo("1.2.3.4", "US", "Miami", 25.77, -80.19, "America/New_York", "en-US")
        val j = g.jittered(1.0, 0.0)
        assertTrue(kotlin.math.abs(j.latitude - g.latitude) < 0.03 && kotlin.math.abs(j.longitude - g.longitude) < 0.04)
        assertEquals(j, app.clonespace.proxy.GeoInfo.fromJson(j.toJson()))
        val cfg = app.clonespace.proxy.ProxyConfig(true, app.clonespace.proxy.ProxyType.SOCKS5, "h", 1, matchLocation = true, geo = j)
        assertEquals(cfg, app.clonespace.proxy.ProxyConfig.fromJson(cfg.toJson()))
    }
}
