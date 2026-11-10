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
