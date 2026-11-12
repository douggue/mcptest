import app.clonespace.data.*
import app.clonespace.profile.*
import app.clonespace.proxy.*
import app.clonespace.shared.Keys
import kotlin.test.*

class LeakTest {
    private val p = ProfileGenerator.generate(35, "15", "pixel8", "DE")
    private val real = mapOf(Keys.ANDROID_ID to "real", Keys.MODEL to "Pixel 6", Keys.PUBLIC_IP to "1.2.3.4", Keys.DNS to "93.184.216.34", Keys.TIMEZONE to "UTC")
    private fun status(rows: List<LeakRow>, k: String) = rows.first { it.key == k }.status

    @Test fun spoofedFieldsAreIsolatedAndRealOnesLeak() {
        val clone = mapOf(Keys.ANDROID_ID to p.androidId, Keys.MODEL to "Pixel 6", Keys.TIMEZONE to p.timezone,
            Keys.MAPS_CONTAINER to "visible", Keys.STACK_CONTAINER to "hidden")
        val rows = LeakAnalyzer.analyze(real, clone, p, ProxyConfig())
        assertEquals(LeakStatus.ISOLATED, status(rows, Keys.ANDROID_ID))
        assertEquals(LeakStatus.LEAK, status(rows, Keys.MODEL))
        assertEquals(LeakStatus.ISOLATED, status(rows, Keys.TIMEZONE))
        assertEquals(LeakStatus.LEAK, status(rows, Keys.MAPS_CONTAINER))
        assertEquals(LeakStatus.ISOLATED, status(rows, Keys.STACK_CONTAINER))
        assertEquals(LeakStatus.UNKNOWN, status(rows, Keys.BRAND))   // no data from the clone
    }
    @Test fun networkWithProxyOn() {
        val proxy = ProxyConfig(true, ProxyType.SOCKS5, "h", 1080)
        var rows = LeakAnalyzer.analyze(real, mapOf(Keys.PUBLIC_IP to "9.9.9.9", Keys.WEBVIEW_IP to "1.2.3.4", Keys.DNS to "198.18.0.5"), p, proxy)
        assertEquals(LeakStatus.ISOLATED, status(rows, Keys.PUBLIC_IP))
        assertEquals(LeakStatus.LEAK, status(rows, Keys.WEBVIEW_IP))
        assertEquals(LeakStatus.ISOLATED, status(rows, Keys.DNS))
        rows = LeakAnalyzer.analyze(real, mapOf(Keys.PUBLIC_IP to "9.9.9.9", Keys.DNS to "93.184.216.34"), p, proxy)
        assertEquals(LeakStatus.LEAK, status(rows, Keys.DNS))
    }
    @Test fun timeZoneAgainstTheProxyLocation() {
        val paris = GeoInfo("9.9.9.9", "FR", "Paris", 48.85, 2.35, "Europe/Paris", "fr-FR")
        val on = ProxyConfig(true, ProxyType.HTTP, "h", 8080, matchLocation = true, geo = paris)
        val key = "proxy_timezone"
        // clone still on the phone's zone while the proxy exits in Paris
        var rows = LeakAnalyzer.analyze(real, mapOf(Keys.TIMEZONE to "America/New_York"), p, on)
        assertEquals(LeakStatus.LEAK, status(rows, key))
        assertTrue("Europe/Paris" in rows.first { it.key == key }.note!!)
        rows = LeakAnalyzer.analyze(real, mapOf(Keys.TIMEZONE to "Europe/Paris"), p, on)
        assertEquals(LeakStatus.ISOLATED, status(rows, key))
        // switch off, or location never found: not a verdict, but the row says why
        rows = LeakAnalyzer.analyze(real, mapOf(Keys.TIMEZONE to "America/New_York"), p, on.copy(matchLocation = false, geo = null))
        assertEquals(LeakStatus.UNKNOWN, status(rows, key))
        assertTrue("is off" in rows.first { it.key == key }.note!!)
        rows = LeakAnalyzer.analyze(real, mapOf(Keys.TIMEZONE to "America/New_York"), p, on.copy(geo = null))
        assertEquals(LeakStatus.UNKNOWN, status(rows, key))
        // no proxy: no such row
        assertTrue(LeakAnalyzer.analyze(real, mapOf(Keys.TIMEZONE to "UTC"), p, ProxyConfig()).none { it.key == key })
    }
    @Test fun networkWithProxyOffIsShared() {
        val rows = LeakAnalyzer.analyze(real, mapOf(Keys.PUBLIC_IP to "1.2.3.4", Keys.DNS to "93.184.216.34"), p, ProxyConfig())
        assertEquals(LeakStatus.SHARED, status(rows, Keys.PUBLIC_IP)); assertEquals(LeakStatus.SHARED, status(rows, Keys.DNS))
    }
    @Test fun screenRowsOnlyWhenSpoofingScreen() {
        assertTrue(LeakAnalyzer.analyze(real, emptyMap(), p, ProxyConfig()).none { it.key == Keys.DENSITY })
        assertTrue(LeakAnalyzer.analyze(real, emptyMap(), p.copy(spoofScreen = true), ProxyConfig()).any { it.key == Keys.DENSITY })
    }
    @Test fun cpuInfoWithoutHardwareLineIsNotALeak() {
        val r = real + (Keys.CPUINFO_HARDWARE to "")
        var rows = LeakAnalyzer.analyze(r, mapOf(Keys.CPUINFO_HARDWARE to ""), p, ProxyConfig())
        assertEquals(LeakStatus.ISOLATED, status(rows, Keys.CPUINFO_HARDWARE))
        rows = LeakAnalyzer.analyze(real + (Keys.CPUINFO_HARDWARE to "Qualcomm"), mapOf(Keys.CPUINFO_HARDWARE to "Qualcomm"), p, ProxyConfig())
        assertEquals(LeakStatus.LEAK, status(rows, Keys.CPUINFO_HARDWARE))
        rows = LeakAnalyzer.analyze(real + (Keys.CPUINFO_HARDWARE to "Qualcomm"), mapOf(Keys.CPUINFO_HARDWARE to p.hardware), p, ProxyConfig())
        assertEquals(LeakStatus.ISOLATED, status(rows, Keys.CPUINFO_HARDWARE))
    }
    @Test fun cpuInfoRewriteOnlyTouchesHardwareLine() {
        val out = ProfileMapper.rewriteCpuInfo("processor\t: 0\nHardware\t: Qualcomm\nRevision\t: 0", p)
        assertTrue(out.contains("Hardware\t: ${p.hardware}")); assertFalse(out.contains("Qualcomm"))
        assertEquals("processor\t: 0", ProfileMapper.rewriteCpuInfo("processor\t: 0", p))
    }
    @Test fun parseIp() { assertEquals("1.2.3.4", app.clonespace.shared.Trace.parseIp("fl=1\nip=1.2.3.4\nloc=US")); assertEquals("", app.clonespace.shared.Trace.parseIp("x")) }
}
