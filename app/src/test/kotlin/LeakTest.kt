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
    @Test fun networkWithProxyOffIsShared() {
        val rows = LeakAnalyzer.analyze(real, mapOf(Keys.PUBLIC_IP to "1.2.3.4", Keys.DNS to "93.184.216.34"), p, ProxyConfig())
        assertEquals(LeakStatus.SHARED, status(rows, Keys.PUBLIC_IP)); assertEquals(LeakStatus.SHARED, status(rows, Keys.DNS))
    }
    @Test fun screenRowsOnlyWhenSpoofingScreen() {
        assertTrue(LeakAnalyzer.analyze(real, emptyMap(), p, ProxyConfig()).none { it.key == Keys.DENSITY })
        assertTrue(LeakAnalyzer.analyze(real, emptyMap(), p.copy(spoofScreen = true), ProxyConfig()).any { it.key == Keys.DENSITY })
    }
    @Test fun parseIp() { assertEquals("1.2.3.4", app.clonespace.shared.Trace.parseIp("fl=1\nip=1.2.3.4\nloc=US")); assertEquals("", app.clonespace.shared.Trace.parseIp("x")) }
}
