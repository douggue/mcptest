import app.clonespace.data.ShortcutParser
import kotlin.test.*

class ShortcutParseTest {
    @Test fun accepts() {
        assertEquals(ShortcutParser.Target(2, "com.whatsapp"), ShortcutParser.parse("clonespace://launch/2/com.whatsapp"))
        assertEquals(ShortcutParser.Target(0, "a.b_c.d9"), ShortcutParser.parse(ShortcutParser.format(0, "a.b_c.d9")))
    }
    @Test fun rejects() {
        for (bad in listOf("clonespace://launch/-1/a.b", "clonespace://launch/1/../x", "clonespace://launch/1/a", "clonespace://other/1/a.b",
            "clonespace://launch/1/a.b/extra", "http://launch/1/a.b", "clonespace://launch/1/a.b?x=1", "clonespace://launch/1234567/a.b",
            "clonespace://launch/1/a.b%2f", "clonespace://launch/ 1/a.b", "clonespace://launch/1/1a.b", "", null))
            assertNull(ShortcutParser.parse(bad), bad)
    }
}
