package app.clonespace.data

import android.content.Context
import app.clonespace.CloneApp
import app.clonespace.engine.VirtualEngine
import app.clonespace.profile.DeviceProfile
import app.clonespace.shared.Collector
import app.clonespace.shared.Keys
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/**
 * Runs the leak test: collects the real phone's values here, installs the probe app into the clone's
 * space with the same profile and proxy, launches it inside the container, waits for the values it
 * saw, and compares the two. The probe is a tiny app built from the :probe module and shipped as an
 * asset; it never contacts anything except the IP-echo URL in [Keys.TRACE_URL].
 */
class LeakTestRunner(private val app: CloneApp) {
    sealed interface State {
        data object Idle : State
        data class Running(val step: String) : State
        data class Done(val rows: List<LeakRow>, val profile: DeviceProfile) : State
        data class Failed(val message: String) : State
    }

    companion object {
        const val PROBE_PKG = "app.clonespace.probe"
        const val ASSET = "probe.apk"
    }

    suspend fun run(item: CloneItem, onStep: (String) -> Unit): State = withContext(Dispatchers.IO) {
        try {
            val profile = app.profiles.load(item.spaceId, item.packageName)
                ?: return@withContext State.Failed("This clone has no profile yet. Open its identity screen first.")
            val proxy = app.proxies.load(item.spaceId, item.packageName)

            onStep("Reading what the real phone returns")
            val real = Collector.collectLocal(app) + Collector.collectNetwork()

            onStep("Preparing the probe in ${item.spaceName}")
            val apk = File(app.cacheDir, ASSET)
            runCatching { app.assets.open(ASSET).use { i -> apk.outputStream().use { o -> i.copyTo(o) } } }
                .onFailure { return@withContext State.Failed("The probe app is not bundled in this build (see README).") }
            VirtualEngine.forceStop(PROBE_PKG, item.spaceId)
            if (VirtualEngine.isInstalled(PROBE_PKG, item.spaceId)) VirtualEngine.uninstall(PROBE_PKG, item.spaceId)
            val inst = VirtualEngine.installApk(apk, item.spaceId)
            if (!inst.ok) return@withContext State.Failed("Could not install the probe: ${inst.message}")

            // The probe runs in this clone's identity: same profile, same proxy, same notification label.
            app.profiles.save(item.spaceId, PROBE_PKG, profile)
            app.proxies.save(item.spaceId, PROBE_PKG, proxy)
            app.meta.setMeta(item.spaceId, PROBE_PKG, app.meta.meta(item.spaceId, item.packageName))

            val result = probeResultFile(app, item.spaceId).also { it.delete() }

            onStep("Launching the probe inside the clone")
            if (!VirtualEngine.launch(PROBE_PKG, item.spaceId)) return@withContext State.Failed("The probe would not start.")

            onStep("Waiting for the clone to report (up to 60 s)")
            var waited = 0
            while (!result.isFile && waited < 60_000) { delay(500); waited += 500 }
            if (!result.isFile) return@withContext State.Failed("The probe did not report back. Check the proxy and try again.")
            delay(300)
            val json = JSONObject(result.readText())
            val clone = HashMap<String, String>()
            for (k in json.keys()) clone[k] = json.optString(k)

            VirtualEngine.forceStop(PROBE_PKG, item.spaceId)
            State.Done(LeakAnalyzer.analyze(real, clone, profile, proxy), profile)
        } catch (t: Throwable) {
            State.Failed(t.message ?: t.javaClass.simpleName)
        }
    }

    /** Where the probe's files/ directory lives for this space: inside the engine's virtual data dir. */
    private fun probeResultFile(host: Context, space: Int): File =
        File(VirtualEngine.dataDirs(host, PROBE_PKG, space).first(), "files/result.json")
}
