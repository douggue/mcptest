package app.clonespace.data

import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.drawable.Drawable
import android.os.Build
import androidx.core.graphics.drawable.toBitmap
import app.clonespace.CloneApp
import app.clonespace.engine.VirtualEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.zip.ZipFile

enum class Support { OK, SPLIT_APK, NO_ARM }

data class DeviceApp(val packageName: String, val label: String, val support: Support)

data class CloneItem(
    val spaceId: Int,
    val spaceName: String,
    val packageName: String,
    val label: String,
    /** 1 for the first copy of this app, 2 for the second, in space order. */
    val number: Int,
    val meta: CloneMeta,
    val health: Health,
) {
    val displayName get() = meta.customName ?: label
    val key get() = "$spaceId:$packageName"
}

/** All slow work runs on Dispatchers.IO. Nothing here may be called from the main thread directly. */
class CloneRepository(private val app: CloneApp) {

    /** Launchable, non-system apps that can be cloned. Uses the launcher <queries> intent, not QUERY_ALL_PACKAGES. */
    suspend fun deviceApps(): List<DeviceApp> = withContext(Dispatchers.IO) {
        val pm = app.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val resolved = if (Build.VERSION.SDK_INT >= 33) {
            pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0L))
        } else {
            @Suppress("DEPRECATION") pm.queryIntentActivities(intent, 0)
        }
        resolved.asSequence()
            .map { it.activityInfo.applicationInfo }
            .filter { it.packageName != app.packageName }
            .filter { isUserApp(it) }
            .distinctBy { it.packageName }
            .map { DeviceApp(it.packageName, pm.getApplicationLabel(it).toString(), abiSupport(it)) }
            .sortedBy { it.label.lowercase() }
            .toList()
    }

    private fun isUserApp(ai: ApplicationInfo): Boolean {
        val system = ai.flags and ApplicationInfo.FLAG_SYSTEM != 0
        val updated = ai.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP != 0
        return !system || updated
    }

    /** Flags apps with native code but no ARM build, and split APKs (the engine copies only the base APK). */
    private fun abiSupport(ai: ApplicationInfo): Support {
        val files = listOfNotNull(ai.sourceDir) + (ai.splitSourceDirs?.toList() ?: emptyList())
        var hasLib = false
        var hasArm = ai.splitSourceDirs?.any { it.contains("arm64") || it.contains("armeabi") } == true
        for (f in files) {
            try {
                ZipFile(f).use { z ->
                    val e = z.entries()
                    while (e.hasMoreElements()) {
                        val n = e.nextElement().name
                        if (n.startsWith("lib/")) {
                            hasLib = true
                            if (n.startsWith("lib/arm64-v8a/") || n.startsWith("lib/armeabi")) hasArm = true
                        }
                    }
                }
            } catch (_: Exception) {
            }
        }
        return when {
            hasLib && !hasArm && ai.splitSourceDirs.isNullOrEmpty() -> Support.NO_ARM
            !ai.splitSourceDirs.isNullOrEmpty() -> Support.SPLIT_APK
            else -> Support.OK
        }
    }

    /** Every clone in every space. */
    suspend fun clones(): List<CloneItem> = withContext(Dispatchers.IO) {
        val ids = VirtualEngine.spaceIds()
        app.meta.adopt(ids)
        val counters = HashMap<String, Int>()
        val out = ArrayList<CloneItem>()
        for (id in ids) {
            val spaceName = app.meta.spaceName(id)
            for (va in VirtualEngine.appsIn(id).sortedBy { VirtualEngine.labelOf(it.info).lowercase() }) {
                val pkg = va.info.packageName
                val n = (counters[pkg] ?: 0) + 1
                counters[pkg] = n
                out += CloneItem(id, spaceName, pkg, VirtualEngine.labelOf(va.info), n, app.meta.meta(id, pkg), app.health.read(id, pkg))
            }
        }
        out
    }

    /**
     * Clones [pkg] into every space in [spaceIds] (batch clone), creating a profile for each copy.
     * [onProgress] is called after each space with (done, total, message of the failure or null).
     */
    suspend fun cloneInto(
        pkg: String,
        spaceIds: List<Int>,
        onProgress: (done: Int, total: Int, error: String?) -> Unit = { _, _, _ -> },
    ): List<Pair<Int, VirtualEngine.InstallOutcome>> = withContext(Dispatchers.IO) {
        val results = ArrayList<Pair<Int, VirtualEngine.InstallOutcome>>()
        spaceIds.forEachIndexed { i, space ->
            val r = VirtualEngine.install(pkg, space)
            if (r.ok) {
                app.profiles.ensure(space, pkg, Build.VERSION.SDK_INT, Build.VERSION.RELEASE)
            }
            results += space to r
            onProgress(i + 1, spaceIds.size, if (r.ok) null else r.message)
        }
        results
    }

    /** Creates [count] new spaces, returns their ids. */
    suspend fun newSpaces(count: Int): List<Space> = withContext(Dispatchers.IO) {
        val existing = VirtualEngine.spaceIds().toSet()
        (1..count).map {
            var s = app.meta.addSpace()
            // Engine and our store must agree on ids.
            while (s.id in existing) s = app.meta.addSpace()
            VirtualEngine.createSpace(s.id)
            s
        }
    }

    suspend fun remove(item: CloneItem) = withContext(Dispatchers.IO) {
        VirtualEngine.uninstall(item.packageName, item.spaceId)
        app.profiles.delete(item.spaceId, item.packageName)
        app.proxies.delete(item.spaceId, item.packageName)
        app.health.delete(item.spaceId, item.packageName)
        app.meta.removeMeta(item.spaceId, item.packageName)
    }

    suspend fun removeSpace(id: Int) = withContext(Dispatchers.IO) {
        VirtualEngine.deleteSpace(id)
        app.profiles.deleteSpace(id); app.proxies.deleteSpace(id); app.health.deleteSpace(id)
        app.meta.removeSpace(id)
    }

    // ---- Icons ----------------------------------------------------------------------------------------

    suspend fun deviceIcon(pkg: String, sizePx: Int): Bitmap? = withContext(Dispatchers.IO) {
        runCatching { app.packageManager.getApplicationIcon(pkg).toBitmap(sizePx, sizePx) }.getOrNull()
    }

    suspend fun cloneIcon(item: CloneItem, sizePx: Int): Bitmap? = withContext(Dispatchers.IO) {
        val info = VirtualEngine.appsIn(item.spaceId).firstOrNull { it.info.packageName == item.packageName }?.info
        val d: Drawable? = info?.let { VirtualEngine.iconOf(it) }
        runCatching { d?.toBitmap(sizePx, sizePx) }.getOrNull()
    }
}
