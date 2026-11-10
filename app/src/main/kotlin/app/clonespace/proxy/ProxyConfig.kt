package app.clonespace.proxy

import org.json.JSONObject
import java.io.File

enum class ProxyType(val nativeId: Int) { SOCKS5(1), HTTP(2) }

data class ProxyConfig(
    val enabled: Boolean = false,
    val type: ProxyType = ProxyType.SOCKS5,
    val host: String = "",
    val port: Int = 1080,
    val username: String = "",
    val password: String = "",
    /** Fail UDP to public addresses so apps fall back to TCP instead of leaking around the proxy. */
    val blockUdp: Boolean = true,
    /** GPS, time zone and language of the clone follow where the proxy exits. */
    val matchLocation: Boolean = false,
    /** Result of the last lookup of the proxy's exit location; null until one succeeded. */
    val geo: GeoInfo? = null,
) {
    val isUsable get() = enabled && host.isNotBlank() && port in 1..65535

    fun toJson(): JSONObject = JSONObject().apply {
        put("enabled", enabled); put("type", type.name); put("host", host); put("port", port)
        put("username", username); put("password", password); put("blockUdp", blockUdp)
        put("matchLocation", matchLocation)
        geo?.let { put("geo", it.toJson()) }
    }

    companion object {
        fun fromJson(o: JSONObject) = ProxyConfig(
            enabled = o.optBoolean("enabled"),
            type = runCatching { ProxyType.valueOf(o.optString("type", "SOCKS5")) }.getOrDefault(ProxyType.SOCKS5),
            host = o.optString("host"), port = o.optInt("port", 1080),
            username = o.optString("username"), password = o.optString("password"),
            blockUdp = o.optBoolean("blockUdp", true),
            matchLocation = o.optBoolean("matchLocation"),
            geo = o.optJSONObject("geo")?.let { runCatching { GeoInfo.fromJson(it) }.getOrNull() },
        )
    }
}

/** Per (space, package) proxy settings: <root>/<space>/<package>.json. */
class ProxyStore(private val root: File) {
    private fun file(space: Int, pkg: String) = File(File(root, space.toString()), "$pkg.json")

    fun load(space: Int, pkg: String): ProxyConfig = try {
        val f = file(space, pkg)
        if (f.isFile) ProxyConfig.fromJson(JSONObject(f.readText())) else ProxyConfig()
    } catch (e: Exception) {
        ProxyConfig()
    }

    fun save(space: Int, pkg: String, cfg: ProxyConfig) {
        val f = file(space, pkg)
        f.parentFile?.mkdirs()
        val tmp = File(f.parentFile, f.name + ".tmp")
        tmp.writeText(cfg.toJson().toString())
        if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
    }

    fun delete(space: Int, pkg: String) { file(space, pkg).delete() }
    fun deleteSpace(space: Int) { File(root, space.toString()).deleteRecursively() }
}
