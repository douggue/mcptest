package app.clonespace.data

import android.os.Build
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * Keeps the last crash of the app itself and of each clone as plain text, so a problem can be
 * reported with the real stack trace instead of "it crashed". Files stay in app-private storage and
 * leave the phone only when the user copies or shares the report.
 */
class CrashLog(private val root: File) {
    private fun cloneFile(space: Int, pkg: String) = File(root, "clone-$space-$pkg.txt")
    private val hostFile get() = File(root, "host.txt")

    fun recordClone(space: Int, pkg: String, process: String, t: Throwable) = write(cloneFile(space, pkg), "$pkg (space $space, process $process)", t)
    fun recordHost(process: String, t: Throwable) = write(hostFile, "CloneSpace ($process)", t)

    fun clone(space: Int, pkg: String): String? = read(cloneFile(space, pkg))
    fun host(): String? = read(hostFile)
    fun hostCrashedAt(): Long = hostFile.takeIf { it.isFile }?.lastModified() ?: 0L
    fun clearHost() { hostFile.delete() }
    fun delete(space: Int, pkg: String) { cloneFile(space, pkg).delete() }

    private fun read(f: File): String? = try { if (f.isFile) f.readText() else null } catch (_: Exception) { null }

    private fun write(f: File, what: String, t: Throwable) {
        try {
            root.mkdirs()
            val sw = StringWriter()
            t.printStackTrace(PrintWriter(sw))
            val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
            f.writeText("$stamp  $what\n" + sw.toString().take(MAX))
        } catch (_: Throwable) {
            // Crash reporting must never cause a second crash.
        }
    }

    /** Everything useful for a bug report, as one text. Slow (runs logcat); call off the main thread. */
    fun report(appVersion: String, clones: List<CloneItem>, settings: (CloneItem) -> List<String> = { emptyList() }): String = buildString {
        append("CloneSpace ").append(appVersion).append('\n')
        append("Phone: ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL)
            .append(", Android ").append(Build.VERSION.RELEASE).append(" (API ").append(Build.VERSION.SDK_INT).append(")\n")
        append("Patch: ").append(Build.VERSION.SECURITY_PATCH).append(", ABI ").append(Build.SUPPORTED_ABIS.joinToString()).append('\n')
        append("Phone time zone ").append(java.util.TimeZone.getDefault().id)
            .append(", language ").append(java.util.Locale.getDefault().toLanguageTag()).append("\n\n")
        append("== Clones ==\n")
        for (c in clones) {
            append(c.label).append(" [").append(c.packageName).append("] space ").append(c.spaceId).append(": ")
            append(when (c.health.lastLaunchOk) { true -> "last launch ok"; false -> "last launch FAILED"; null -> "never launched" })
            append(", crashes ").append(c.health.crashes).append('\n')
            // What the clone is set to be: without it a report cannot explain a wrong time zone or a slow proxy.
            for (line in runCatching { settings(c) }.getOrDefault(emptyList())) append("    ").append(line).append('\n')
        }
        host()?.let { append("\n== App crash ==\n").append(it).append('\n') }
        for (c in clones) clone(c.spaceId, c.packageName)?.let { append("\n== Clone crash ==\n").append(it).append('\n') }
        append("\n== Recent log (this app only) ==\n").append(logcat())
    }

    /** An app can read only its own log lines; clones run under this app, so their lines are included. */
    private fun logcat(): String = try {
        val p = ProcessBuilder("logcat", "-d", "-t", "600", "-v", "time", "*:W", "ProxyHook:D").redirectErrorStream(true).start()
        val text = p.inputStream.bufferedReader().use { it.readText() }
        if (!p.waitFor(5, TimeUnit.SECONDS)) p.destroy()
        text.takeLast(60_000)
    } catch (t: Throwable) {
        "log not available: ${t.message}"
    }

    private companion object { const val MAX = 24_000 }
}
