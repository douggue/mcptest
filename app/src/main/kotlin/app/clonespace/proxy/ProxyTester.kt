package app.clonespace.proxy

import app.clonespace.shared.Keys
import app.clonespace.shared.Trace
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * Connection test for the proxy screen. Opens a TCP connection to the proxy, does the SOCKS5 or
 * HTTP CONNECT handshake to 1.1.1.1:443, runs TLS over the tunnel and reads the exit IP.
 * Runs in the UI process with explicit sockets, so it is not affected by any clone hook.
 */
object ProxyTester {
    data class Result(val ok: Boolean, val exitIp: String?, val latencyMs: Long, val error: String?)

    suspend fun test(cfg: ProxyConfig): Result = withContext(Dispatchers.IO) {
        val start = System.nanoTime()
        try {
            require(cfg.host.isNotBlank()) { "Enter a proxy host" }
            Socket().use { raw ->
                raw.soTimeout = 10_000
                raw.connect(InetSocketAddress(cfg.host, cfg.port), 8_000)
                val out = raw.getOutputStream(); val inp = raw.getInputStream()
                when (cfg.type) {
                    ProxyType.SOCKS5 -> socks5(inp, out, cfg, byteArrayOf(1, 1, 1, 1), 443)
                    ProxyType.HTTP -> httpConnect(inp, out, cfg, "1.1.1.1", 443)
                }
                val tls = (SSLSocketFactory.getDefault() as SSLSocketFactory)
                    .createSocket(raw, "1.1.1.1", 443, false) as SSLSocket
                val params = tls.sslParameters
                params.endpointIdentificationAlgorithm = "HTTPS"
                tls.sslParameters = params
                tls.startHandshake()
                val request = "GET /cdn-cgi/trace HTTP/1.1\r\nHost: 1.1.1.1\r\nConnection: close\r\n\r\n"
                tls.outputStream.write(request.toByteArray()); tls.outputStream.flush()
                val body = tls.inputStream.readBytes().toString(Charsets.UTF_8)
                val ip = Trace.parseIp(body)
                val ms = (System.nanoTime() - start) / 1_000_000
                if (ip.isEmpty()) Result(false, null, ms, "Connected, but the reply was not understood")
                else Result(true, ip, ms, null)
            }
        } catch (t: Throwable) {
            Result(false, null, (System.nanoTime() - start) / 1_000_000, t.message ?: t.javaClass.simpleName)
        }
    }

    /**
     * Asks a public IP-location service where the proxy exits. The request goes through the proxy,
     * so the service sees only the proxy's address, never the phone's. Two services are tried.
     */
    suspend fun locate(cfg: ProxyConfig): GeoInfo? = withContext(Dispatchers.IO) {
        for ((host, path) in listOf("ipwho.is" to "/", "ipapi.co" to "/json/")) {
            val geo = runCatching { GeoInfo.parse(httpsGet(cfg, host, path)) }.getOrNull()
            if (geo != null) return@withContext geo
        }
        null
    }

    /** HTTPS GET of https://host/path through the proxy; the proxy resolves the host name. */
    private fun httpsGet(cfg: ProxyConfig, host: String, path: String): String {
        Socket().use { raw ->
            raw.soTimeout = 10_000
            raw.connect(InetSocketAddress(cfg.host, cfg.port), 8_000)
            val out = raw.getOutputStream(); val inp = raw.getInputStream()
            when (cfg.type) {
                ProxyType.SOCKS5 -> socks5(inp, out, cfg, null, 443, host)
                ProxyType.HTTP -> httpConnect(inp, out, cfg, host, 443)
            }
            val tls = (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket(raw, host, 443, false) as SSLSocket
            val params = tls.sslParameters
            params.endpointIdentificationAlgorithm = "HTTPS"
            tls.sslParameters = params
            tls.startHandshake()
            val request = "GET $path HTTP/1.1\r\nHost: $host\r\nAccept: application/json\r\nUser-Agent: curl/8.5.0\r\nConnection: close\r\n\r\n"
            tls.outputStream.write(request.toByteArray()); tls.outputStream.flush()
            val bytes = java.io.ByteArrayOutputStream()
            val buf = ByteArray(8192)
            try {
                while (bytes.size() < 200_000) { val n = tls.inputStream.read(buf); if (n < 0) break; bytes.write(buf, 0, n) }
            } catch (_: java.io.IOException) {
                // Some servers close without a TLS close_notify; what was read is still usable.
            }
            return bytes.toString("UTF-8")
        }
    }

    private fun read(inp: InputStream, n: Int): ByteArray {
        val b = ByteArray(n); var o = 0
        while (o < n) { val r = inp.read(b, o, n - o); if (r < 0) throw java.io.IOException("Proxy closed the connection"); o += r }
        return b
    }

    private fun socks5(inp: InputStream, out: OutputStream, cfg: ProxyConfig, ipv4: ByteArray?, port: Int, domain: String? = null) {
        val auth = cfg.username.isNotEmpty()
        out.write(if (auth) byteArrayOf(5, 2, 0, 2) else byteArrayOf(5, 1, 0)); out.flush()
        val rep = read(inp, 2)
        if (rep[0] != 5.toByte()) throw java.io.IOException("Not a SOCKS5 proxy")
        when (rep[1].toInt()) {
            0 -> {}
            2 -> {
                if (!auth) throw java.io.IOException("Proxy needs a username and password")
                val u = cfg.username.toByteArray(); val p = cfg.password.toByteArray()
                out.write(byteArrayOf(1, u.size.toByte()) + u + byteArrayOf(p.size.toByte()) + p); out.flush()
                if (read(inp, 2)[1].toInt() != 0) throw java.io.IOException("Wrong username or password")
            }
            else -> throw java.io.IOException("Proxy rejected the login method")
        }
        val target = if (ipv4 != null) byteArrayOf(1) + ipv4 else {
            val d = (domain ?: throw java.io.IOException("No destination")).toByteArray()
            byteArrayOf(3, d.size.toByte()) + d
        }
        out.write(byteArrayOf(5, 1, 0) + target + byteArrayOf((port shr 8).toByte(), port.toByte())); out.flush()
        val h = read(inp, 4)
        if (h[1].toInt() != 0) throw java.io.IOException("Proxy refused the connection (code ${h[1]})")
        when (h[3].toInt()) { 1 -> read(inp, 6); 4 -> read(inp, 18); 3 -> { val l = read(inp, 1)[0].toInt() and 0xFF; read(inp, l + 2) } }
    }

    private fun httpConnect(inp: InputStream, out: OutputStream, cfg: ProxyConfig, host: String, port: Int) {
        val sb = StringBuilder("CONNECT $host:$port HTTP/1.1\r\nHost: $host:$port\r\n")
        if (cfg.username.isNotEmpty()) {
            val cred = java.util.Base64.getEncoder().encodeToString("${cfg.username}:${cfg.password}".toByteArray())
            sb.append("Proxy-Authorization: Basic $cred\r\n")
        }
        sb.append("\r\n")
        out.write(sb.toString().toByteArray()); out.flush()
        val head = StringBuilder()
        while (!head.endsWith("\r\n\r\n")) {
            val b = inp.read(); if (b < 0) throw java.io.IOException("Proxy closed the connection"); head.append(b.toChar())
            if (head.length > 8192) throw java.io.IOException("Proxy reply too long")
        }
        val status = head.lines().first()
        if (!Regex("^HTTP/\\d\\.\\d 200").containsMatchIn(status)) throw java.io.IOException("Proxy said: $status")
    }
}
