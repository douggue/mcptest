package app.clonespace.engine

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.pm.ApplicationInfo
import android.graphics.drawable.Drawable
import android.os.Handler
import android.os.Looper
import android.util.Log
import app.clonespace.BuildConfig
import app.clonespace.CloneApp
import app.clonespace.profile.ProfileApplier
import app.clonespace.profile.ProfileMapper
import app.clonespace.proxy.ProxyConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import top.niunaijun.blackbox.BlackBoxCore
import top.niunaijun.blackbox.app.configuration.AppLifecycleCallback
import top.niunaijun.blackbox.app.configuration.ClientConfiguration
import top.niunaijun.blackbox.core.NativeCore
import top.niunaijun.blackbox.fake.spoof.IdentityStore
import top.niunaijun.blackbox.fake.spoof.NotificationLabel
import java.io.File
import java.net.InetAddress

/**
 * The only file that touches the engine (BlackBoxCore, NativeCore, IdentityStore, ...).
 * Swapping the engine means rewriting this file; nothing else knows which engine is underneath.
 *
 * Threading: every suspend function runs on Dispatchers.IO. The engine's own calls can take
 * seconds (installPackageAsUser copies an APK), so nothing here may be called on the main thread.
 */
object VirtualEngine {
    private const val TAG = "VirtualEngine"

    data class InstallOutcome(val ok: Boolean, val message: String?)
    data class VirtualApp(val spaceId: Int, val info: ApplicationInfo)

    @Volatile var isReady: Boolean = false; private set
    @Volatile var startupFailed: Boolean = false; private set

    /** True once this process has become a clone (target app code is about to run in it). */
    @Volatile var inClone: Boolean = false; private set

    /** True in the process that shows the UI. Clone and server processes run the same Application. */
    val isUiProcess: Boolean get() = BlackBoxCore.get().isMainProcess

    // ---- Startup ------------------------------------------------------------------------------

    /** Application.attachBaseContext, every process. Must come first. */
    fun attach(base: Context, app: Application) {
        val core = BlackBoxCore.get()
        core.doAttachBaseContext(base, HostConfiguration(base.packageName))
        core.addAppLifecycleCallback(CloneLifecycle(app as CloneApp))
    }

    /**
     * Application.onCreate, every process. In the UI process the slow part runs on a background
     * thread and [onDone] is called on the main thread; in clone processes it is synchronous.
     */
    fun start(onDone: (Boolean) -> Unit = {}) {
        BlackBoxCore.get().doCreateAsync { ok ->
            isReady = ok
            startupFailed = !ok
            onDone(ok)
        }
    }

    // ---- Spaces and apps ----------------------------------------------------------------------

    suspend fun spaceIds(): List<Int> = withContext(Dispatchers.IO) {
        BlackBoxCore.get().users.map { it.id }.sorted()
    }

    suspend fun createSpace(id: Int) = withContext(Dispatchers.IO) { BlackBoxCore.get().createUser(id); Unit }

    suspend fun deleteSpace(id: Int) = withContext(Dispatchers.IO) { BlackBoxCore.get().deleteUser(id) }

    suspend fun appsIn(spaceId: Int): List<VirtualApp> = withContext(Dispatchers.IO) {
        BlackBoxCore.get().getInstalledApplications(0, spaceId).map { VirtualApp(spaceId, it) }
    }

    suspend fun isInstalled(pkg: String, spaceId: Int): Boolean = withContext(Dispatchers.IO) {
        BlackBoxCore.get().isInstalled(pkg, spaceId)
    }

    /** Copies the installed app into [spaceId]. Slow. Creates the space first when it does not exist. */
    suspend fun install(pkg: String, spaceId: Int): InstallOutcome = withContext(Dispatchers.IO) {
        try {
            val core = BlackBoxCore.get()
            core.createUser(spaceId)
            val r = core.installPackageAsUser(pkg, spaceId)
            InstallOutcome(r.success, r.msg)
        } catch (t: Throwable) {
            Log.w(TAG, "install failed", t)
            InstallOutcome(false, t.message ?: t.javaClass.simpleName)
        }
    }

    /** Installs an APK file (used for the leak-test probe). */
    suspend fun installApk(apk: File, spaceId: Int): InstallOutcome = withContext(Dispatchers.IO) {
        try {
            val core = BlackBoxCore.get()
            core.createUser(spaceId)
            val r = core.installPackageAsUser(apk, spaceId)
            InstallOutcome(r.success, r.msg)
        } catch (t: Throwable) {
            InstallOutcome(false, t.message ?: t.javaClass.simpleName)
        }
    }

    suspend fun uninstall(pkg: String, spaceId: Int) = withContext(Dispatchers.IO) {
        BlackBoxCore.get().uninstallPackageAsUser(pkg, spaceId)
    }

    suspend fun clearData(pkg: String, spaceId: Int) = withContext(Dispatchers.IO) {
        BlackBoxCore.get().clearPackage(pkg, spaceId)
    }

    suspend fun forceStop(pkg: String, spaceId: Int) = withContext(Dispatchers.IO) {
        BlackBoxCore.get().stopPackage(pkg, spaceId)
    }

    /** Returns true when a launch intent was found and started. */
    suspend fun launch(pkg: String, spaceId: Int): Boolean = withContext(Dispatchers.IO) {
        try { BlackBoxCore.get().launchApk(pkg, spaceId) } catch (t: Throwable) { Log.w(TAG, "launch failed", t); false }
    }

    // ---- Labels and icons (host PackageManager over the virtual app's ApplicationInfo) ------------

    fun labelOf(info: ApplicationInfo): String =
        runCatching { BlackBoxCore.getPackageManager().getApplicationLabel(info).toString() }.getOrDefault(info.packageName)

    fun iconOf(info: ApplicationInfo): Drawable? =
        runCatching { BlackBoxCore.getPackageManager().getApplicationIcon(info) }.getOrNull()

    // ---- Storage access (sideload flavour only) ---------------------------------------------------

    fun hasAllFilesAccess(): Boolean = runCatching { BlackBoxCore.get().hasAllFilesAccess() }.getOrDefault(false)

    fun requestAllFilesAccess(activity: Activity) { runCatching { BlackBoxCore.get().requestAllFilesAccess(activity) } }

    // ---- Google Play services inside a space ------------------------------------------------------

    fun gmsSupported(): Boolean = runCatching { BlackBoxCore.get().isSupportGms }.getOrDefault(false)

    suspend fun gmsInstalled(spaceId: Int): Boolean = withContext(Dispatchers.IO) {
        runCatching { BlackBoxCore.get().isInstallGms(spaceId) }.getOrDefault(false)
    }

    suspend fun installGms(spaceId: Int): InstallOutcome = withContext(Dispatchers.IO) {
        runCatching { BlackBoxCore.get().installGms(spaceId) }
            .map { InstallOutcome(it.success, it.msg) }
            .getOrElse { InstallOutcome(false, it.message) }
    }

    // ---- Where the engine keeps a clone's data (for backup and restore) ---------------------------

    /** Mirrors BEnvironment.getDataDir / getDeDataDir / getExternalDataDir in the engine source. */
    fun dataDirs(host: Context, pkg: String, spaceId: Int): List<File> {
        val root = File(host.cacheDir.parent, "blackbox")
        return listOf(
            File(root, "data/user/$spaceId/$pkg"),
            File(root, "data/user_de/$spaceId/$pkg"),
        )
    }

    // ---- Clone-process setup (called from the lifecycle callback) ---------------------------------

    private class HostConfiguration(private val pkg: String) : ClientConfiguration() {
        override fun getHostPackageName(): String = pkg
        override fun isEnableDaemonService(): Boolean = true
        override fun isUseVpnNetwork(): Boolean = false          // per-clone proxy is in-process
        override fun getLogSenderChatId(): String? = null        // never upload logs
    }

    /** Runs inside clone processes, before the target app's code. */
    private class CloneLifecycle(private val host: CloneApp) : AppLifecycleCallback() {
        @Volatile private var props: Map<String, String> = emptyMap()

        override fun beforeCreateApplication(packageName: String, processName: String, context: Context, userId: Int) {
            inClone = true
            try {
                val profile = host.profiles.load(userId, packageName)
                if (profile != null) {
                    IdentityStore.set(ProfileMapper.identity(profile))
                    ProfileApplier.applyBuild(profile)
                    ProfileApplier.applyLocaleAndTimezone(profile)
                    props = ProfileMapper.systemProperties(profile)
                    NativeCore.configureSpoof(ProfileMapper.nativeArray(props), emptyArray())
                    redirectCpuInfo(profile, userId, packageName)
                } else {
                    Log.w(TAG, "No profile for $packageName in space $userId; running unspoofed")
                }
                NotificationLabel.set(
                    host.meta.meta(userId, packageName).notificationLabel ?: host.meta.spaceName(userId)
                )
                applyProxy(host.proxies.load(userId, packageName))
            } catch (t: Throwable) {
                // Never stop the clone from starting because spoofing failed; the leak test shows it.
                Log.e(TAG, "beforeCreateApplication failed", t)
            }
        }

        override fun beforeApplicationOnCreate(packageName: String, processName: String, application: Application, userId: Int) {
            try {
                host.profiles.load(userId, packageName)?.let {
                    ProfileApplier.applyResources(application, it)
                    ProfileApplier.keepLocale(application, it)
                }
                // Hide the container from /proc/self/maps once the engine itself has finished loading.
                NativeCore.configureSpoof(ProfileMapper.nativeArray(props), ProfileMapper.mapsNeedles.toTypedArray())
                val previous = Thread.getDefaultUncaughtExceptionHandler()
                Thread.setDefaultUncaughtExceptionHandler { t, e ->
                    host.health.recordCrash(userId, packageName, e.javaClass.simpleName + ": " + e.message)
                    host.crashes.recordClone(userId, packageName, processName, e)
                    previous?.uncaughtException(t, e)
                }
            } catch (t: Throwable) {
                Log.e(TAG, "beforeApplicationOnCreate failed", t)
            }
        }

        override fun afterApplicationOnCreate(packageName: String, processName: String, application: Application, userId: Int) {
            host.health.recordLaunch(userId, packageName, ok = true)
        }

        override fun onStoragePermissionNeeded(packageName: String, userId: Int): Boolean =
            StorageGate.onNeeded(packageName, userId)

        private fun redirectCpuInfo(p: app.clonespace.profile.DeviceProfile, userId: Int, pkg: String) {
            runCatching {
                val real = File("/proc/cpuinfo").readText()
                val out = File(host.cacheDir, "fakeproc/$userId/$pkg.cpuinfo")
                out.parentFile?.mkdirs()
                out.writeText(ProfileMapper.rewriteCpuInfo(real, p))
                NativeCore.addIORule("/proc/cpuinfo", out.absolutePath)
            }
        }
    }

    /** Configures (or clears) the in-process proxy. The proxy host is resolved off the clone's main thread. */
    private fun applyProxy(cfg: ProxyConfig) {
        if (!cfg.isUsable) { NativeCore.configureProxy(0, null, 0, null, null, true); return }
        var ip: String? = null
        val t = Thread { ip = runCatching { InetAddress.getByName(cfg.host).hostAddress }.getOrNull() }
        t.start(); t.join(4000)
        val resolved = ip
        if (resolved == null) {
            // Fail closed: a clone that was meant to use a proxy must not silently go direct.
            Log.w(TAG, "Proxy host did not resolve; blocking by pointing at a dead address")
            NativeCore.configureProxy(cfg.type.nativeId, "127.0.0.1", 9, null, null, true)
            return
        }
        NativeCore.configureProxy(cfg.type.nativeId, resolved, cfg.port, cfg.username, cfg.password, cfg.blockUdp)
    }

    /** Handoff between the engine's launch check (UI process) and the UI. */
    object StorageGate {
        @Volatile var bypassOnce: String? = null
        @Volatile var pending: ((String, Int) -> Unit)? = null

        fun onNeeded(pkg: String, userId: Int): Boolean {
            // The Play build does not request all-files access, so it never intercepts launches.
            if (BuildConfig.FLAVOR == "play") return false
            if (bypassOnce == "$userId:$pkg") { bypassOnce = null; return false }
            val cb = pending ?: return false
            Handler(Looper.getMainLooper()).post { cb(pkg, userId) }
            return true
        }
    }
}
