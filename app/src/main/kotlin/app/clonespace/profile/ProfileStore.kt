package app.clonespace.profile

import org.json.JSONObject
import java.io.File

/**
 * File-backed profiles, one per (space, package): <root>/<space>/<package>.json.
 * Written by the UI process, read by the UI process and by clone processes. Writes are atomic
 * (temp file + rename) so a clone process never sees a half-written profile.
 */
class ProfileStore(private val root: File) {
    private fun file(space: Int, pkg: String): File {
        require(pkg.matches(PKG_RE)) { "bad package name" }
        return File(File(root, space.toString()), "$pkg.json")
    }

    fun load(space: Int, pkg: String): DeviceProfile? = try {
        val f = file(space, pkg)
        if (f.isFile) DeviceProfile.fromJson(JSONObject(f.readText())) else null
    } catch (e: Exception) {
        null
    }

    fun save(space: Int, pkg: String, profile: DeviceProfile) {
        val f = file(space, pkg)
        f.parentFile?.mkdirs()
        val tmp = File(f.parentFile, f.name + ".tmp")
        tmp.writeText(profile.toJson().toString())
        if (!tmp.renameTo(f)) {
            f.delete()
            check(tmp.renameTo(f)) { "could not write profile" }
        }
    }

    fun ensure(space: Int, pkg: String, realSdk: Int, realRelease: String): DeviceProfile =
        load(space, pkg) ?: ProfileGenerator.forDevice(
            realSdk, realRelease,
            java.util.Locale.getDefault().country, java.util.Locale.getDefault().toLanguageTag(), java.util.TimeZone.getDefault().id,
        ).also { save(space, pkg, it) }

    /**
     * One-time repair for profiles made by earlier builds, which picked a random country. Sets the
     * language and time zone of every unlocked profile to the phone's. Identifiers are not touched,
     * so accounts keep seeing the same device. Call from the UI process only (clone processes have a
     * spoofed locale).
     */
    fun alignLocaleOnce(languageTag: String, timezone: String) {
        val marker = File(root, ".locale-v2")
        if (marker.exists() || languageTag.isBlank() || timezone.isBlank()) return
        try {
            root.mkdirs()
            root.listFiles()?.filter { it.isDirectory }?.forEach { dir ->
                val space = dir.name.toIntOrNull() ?: return@forEach
                dir.listFiles()?.filter { it.name.endsWith(".json") }?.forEach { f ->
                    val pkg = f.name.removeSuffix(".json")
                    val p = load(space, pkg) ?: return@forEach
                    if (!p.locked && (p.locale != languageTag || p.timezone != timezone)) save(space, pkg, p.copy(locale = languageTag, timezone = timezone))
                }
            }
            marker.writeText("1")
        } catch (_: Exception) {
        }
    }

    /** Regenerate identifiers. A locked profile is returned unchanged. */
    fun regenerate(space: Int, pkg: String, newDevice: Boolean = false): DeviceProfile? {
        val old = load(space, pkg) ?: return null
        if (old.locked) return old
        val fresh = if (newDevice) ProfileGenerator.reroll(old) else ProfileGenerator.regenerate(old)
        save(space, pkg, fresh)
        return fresh
    }

    fun setLocked(space: Int, pkg: String, locked: Boolean): DeviceProfile? {
        val old = load(space, pkg) ?: return null
        return old.copy(locked = locked).also { save(space, pkg, it) }
    }

    fun update(space: Int, pkg: String, transform: (DeviceProfile) -> DeviceProfile): DeviceProfile? {
        val old = load(space, pkg) ?: return null
        return transform(old).also { save(space, pkg, it) }
    }

    fun delete(space: Int, pkg: String) { file(space, pkg).delete() }

    fun deleteSpace(space: Int) { File(root, space.toString()).deleteRecursively() }

    fun export(space: Int, pkg: String): String? = load(space, pkg)?.toJson()?.toString(2)

    /** Import validates structure and consistency; anything else is rejected, nothing is half-applied. */
    fun import(space: Int, pkg: String, json: String): Result<DeviceProfile> = runCatching {
        val p = DeviceProfile.fromJson(JSONObject(json))
        require(ProfileGenerator.isConsistent(p)) { "profile is not internally consistent" }
        // An imported profile keeps the real OS level of this phone.
        save(space, pkg, p)
        p
    }

    companion object {
        val PKG_RE = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$")
    }
}
