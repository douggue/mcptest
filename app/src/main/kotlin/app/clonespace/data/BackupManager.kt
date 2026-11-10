package app.clonespace.data

import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * Backup and restore of one clone's data directories into a single zip, written to or read from any
 * stream (the UI passes Storage Access Framework streams, so no storage permission is needed).
 *
 * Layout: manifest.json, then "d0/..." and "d1/..." for each directory in [dirs] order.
 * Restore never trusts entry names (zip-slip safe) and refuses a backup of a different package.
 */
object BackupManager {
    const val MANIFEST = "manifest.json"
    private const val FORMAT = 1

    data class Manifest(val pkg: String, val spaceId: Int, val createdAt: Long, val profileJson: String?)

    fun backup(out: OutputStream, pkg: String, spaceId: Int, dirs: List<File>, profileJson: String?, now: Long = System.currentTimeMillis()): Long {
        var bytes = 0L
        ZipOutputStream(out.buffered()).use { zip ->
            val m = JSONObject().put("format", FORMAT).put("pkg", pkg).put("space", spaceId).put("createdAt", now)
            profileJson?.let { m.put("profile", JSONObject(it)) }
            zip.putNextEntry(ZipEntry(MANIFEST)); zip.write(m.toString().toByteArray()); zip.closeEntry()
            dirs.forEachIndexed { i, dir ->
                if (!dir.isDirectory) return@forEachIndexed
                dir.walkTopDown().forEach { f ->
                    val rel = f.relativeTo(dir).path.replace(File.separatorChar, '/')
                    if (f.isDirectory) {
                        if (rel.isNotEmpty()) { zip.putNextEntry(ZipEntry("d$i/$rel/")); zip.closeEntry() }
                    } else if (f.isFile && !java.nio.file.Files.isSymbolicLink(f.toPath())) {
                        zip.putNextEntry(ZipEntry("d$i/$rel"))
                        f.inputStream().use { bytes += it.copyTo(zip) }
                        zip.closeEntry()
                    }
                }
            }
        }
        return bytes
    }

    /**
     * Restores into [dirs]. The caller must have force-stopped the clone first. Existing contents of
     * each directory are replaced only after the whole zip has been read into a staging directory.
     */
    fun restore(input: InputStream, expectedPkg: String, dirs: List<File>, staging: File): Result<Manifest> = runCatching {
        staging.deleteRecursively(); staging.mkdirs()
        var manifest: Manifest? = null
        ZipInputStream(input.buffered()).use { zip ->
            var e: ZipEntry? = zip.nextEntry
            while (e != null) {
                val name = e.name
                if (name == MANIFEST) {
                    val o = JSONObject(String(zip.readBytes()))
                    manifest = Manifest(o.getString("pkg"), o.optInt("space"), o.optLong("createdAt"), o.optJSONObject("profile")?.toString())
                    if (manifest!!.pkg != expectedPkg) throw IOException("backup is for ${manifest!!.pkg}, not $expectedPkg")
                } else if (!e.isDirectory) {
                    val target = File(staging, name).canonicalFile
                    if (!target.path.startsWith(staging.canonicalPath + File.separator)) throw IOException("bad entry: $name")
                    if (!Regex("d[0-9]/.+").matches(name)) throw IOException("unexpected entry: $name")
                    target.parentFile?.mkdirs()
                    target.outputStream().use { zip.copyTo(it) }
                }
                zip.closeEntry()
                e = zip.nextEntry
            }
        }
        val m = manifest ?: throw IOException("not a CloneSpace backup")
        dirs.forEachIndexed { i, dir ->
            val src = File(staging, "d$i")
            dir.deleteRecursively()
            if (src.isDirectory) {
                dir.parentFile?.mkdirs()
                if (!src.renameTo(dir)) { src.copyRecursively(dir, overwrite = true) }
            }
        }
        staging.deleteRecursively()
        m
    }.also { if (it.isFailure) staging.deleteRecursively() }
}
