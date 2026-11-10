package app.clonespace

import android.app.Application
import android.content.Context
import app.clonespace.data.CrashLog
import app.clonespace.data.HealthStore
import app.clonespace.data.MetaStore
import app.clonespace.engine.VirtualEngine
import app.clonespace.profile.ProfileStore
import app.clonespace.proxy.ProxyStore
import java.io.File

/**
 * Runs in every process the engine starts (UI, server and one per running clone), so keep it light:
 * only the stores, which are plain file wrappers, and the engine attach.
 */
class CloneApp : Application() {
    lateinit var profiles: ProfileStore; private set
    lateinit var proxies: ProxyStore; private set
    lateinit var health: HealthStore; private set
    lateinit var meta: MetaStore; private set
    lateinit var crashes: CrashLog; private set

    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(base)
        VirtualEngine.attach(base, this)
    }

    override fun onCreate() {
        super.onCreate()
        val files: File = filesDir
        profiles = ProfileStore(File(files, "profiles"))
        proxies = ProxyStore(File(files, "proxies"))
        health = HealthStore(File(files, "health"))
        meta = MetaStore(File(files, "meta.json"))
        crashes = CrashLog(File(files, "crashes"))
        installHostCrashRecorder()
        // UI process: background thread + callback. Clone/server processes: synchronous.
        VirtualEngine.start()
    }

    /** Records crashes of the app's own processes (UI and engine server). Clones add their own in VirtualEngine. */
    private fun installHostCrashRecorder() {
        val process = if (android.os.Build.VERSION.SDK_INT >= 28) getProcessName() else "app"
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            if (!VirtualEngine.inClone) crashes.recordHost(process, e)
            previous?.uncaughtException(t, e)
        }
    }

    companion object {
        lateinit var instance: CloneApp private set
    }

    init { instance = this }
}
