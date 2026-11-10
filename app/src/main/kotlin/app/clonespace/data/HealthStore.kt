package app.clonespace.data

import java.io.File

/**
 * Clone health: an append-only event log per (space, package), written by clone processes (same
 * UID, so they can write here) and read by the UI.
 * Line format: "L <epochMs> ok|fail" for a launch, "C <epochMs> <message>" for a crash.
 */
data class Health(val lastLaunchOk: Boolean?, val lastLaunchAt: Long, val crashes: Int, val lastCrashAt: Long) {
    val isDegraded get() = lastLaunchOk == false || crashes > 0
    companion object { val NONE = Health(null, 0L, 0, 0L) }
}

class HealthStore(private val root: File) {
    private fun file(space: Int, pkg: String) = File(File(root, space.toString()), "$pkg.log")

    fun recordLaunch(space: Int, pkg: String, ok: Boolean, now: Long = System.currentTimeMillis()) =
        append(space, pkg, "L $now ${if (ok) "ok" else "fail"}")

    fun recordCrash(space: Int, pkg: String, message: String?, now: Long = System.currentTimeMillis()) =
        append(space, pkg, "C $now ${(message ?: "").replace('\n', ' ').take(120)}")

    private fun append(space: Int, pkg: String, line: String) {
        try {
            val f = file(space, pkg)
            f.parentFile?.mkdirs()
            f.appendText(line + "\n")
        } catch (_: Exception) {
            // Health reporting must never break a clone.
        }
    }

    fun read(space: Int, pkg: String): Health {
        val f = file(space, pkg)
        if (!f.isFile) return Health.NONE
        var ok: Boolean? = null; var at = 0L; var crashes = 0; var crashAt = 0L
        for (line in f.readLines()) {
            val p = line.split(' ', limit = 3)
            if (p.size < 2) continue
            val t = p[1].toLongOrNull() ?: continue
            when (p[0]) {
                "L" -> { ok = p.getOrNull(2) == "ok"; at = t; /* a new launch starts a new crash window */ crashes = 0 }
                "C" -> { crashes++; crashAt = t }
            }
        }
        return Health(ok, at, crashes, crashAt)
    }

    /** Keep logs small: trim to the newest [keep] lines. */
    fun trim(space: Int, pkg: String, keep: Int = 100) {
        val f = file(space, pkg)
        if (!f.isFile) return
        val lines = f.readLines()
        if (lines.size > keep * 2) f.writeText(lines.takeLast(keep).joinToString("\n") + "\n")
    }

    fun delete(space: Int, pkg: String) { file(space, pkg).delete() }
    fun deleteSpace(space: Int) { File(root, space.toString()).deleteRecursively() }
}
