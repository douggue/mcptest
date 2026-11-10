package app.clonespace.data

import app.clonespace.profile.ProfileStore

/** Strict parser for shortcut links: clonespace://launch/<space>/<package>. No Android types. */
object ShortcutParser {
    const val SCHEME = "clonespace"
    const val HOST = "launch"

    data class Target(val spaceId: Int, val packageName: String)

    private val RE = Regex("^$SCHEME://$HOST/([0-9]{1,6})/([A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z0-9_]+)+)$")

    fun parse(uri: String?): Target? {
        if (uri == null) return null
        val m = RE.matchEntire(uri) ?: return null
        val space = m.groupValues[1].toIntOrNull() ?: return null
        val pkg = m.groupValues[2]
        if (pkg.length > 255 || !ProfileStore.PKG_RE.matches(pkg)) return null
        return Target(space, pkg)
    }

    fun format(spaceId: Int, pkg: String) = "$SCHEME://$HOST/$spaceId/$pkg"
}
