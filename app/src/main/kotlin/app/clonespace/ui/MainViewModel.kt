package app.clonespace.ui

import android.app.Application
import android.content.Context
import android.net.Uri
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.clonespace.CloneApp
import app.clonespace.ShortcutSupport
import app.clonespace.data.BackupManager
import app.clonespace.data.CloneItem
import app.clonespace.data.CloneMeta
import app.clonespace.data.CloneRepository
import app.clonespace.data.DeviceApp
import app.clonespace.data.LeakTestRunner
import app.clonespace.data.Space
import app.clonespace.engine.VirtualEngine
import app.clonespace.profile.DeviceProfile
import app.clonespace.proxy.ProxyConfig
import app.clonespace.proxy.ProxyTester
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class MainViewModel(private val app: CloneApp) : ViewModel() {
    private val repo = CloneRepository(app)
    private val leakRunner = LeakTestRunner(app)

    private val _clones = MutableStateFlow<List<CloneItem>>(emptyList())
    val clones: StateFlow<List<CloneItem>> = _clones.asStateFlow()

    private val _spaces = MutableStateFlow<List<Space>>(emptyList())
    val spaces: StateFlow<List<Space>> = _spaces.asStateFlow()

    private val _deviceApps = MutableStateFlow<List<DeviceApp>?>(null)
    val deviceApps: StateFlow<List<DeviceApp>?> = _deviceApps.asStateFlow()

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val messages: SharedFlow<String> = _messages.asSharedFlow()

    var spaceFilter by mutableStateOf<Int?>(null)
    var busy by mutableStateOf<String?>(null); private set
    var leak by mutableStateOf<LeakTestRunner.State>(LeakTestRunner.State.Idle); private set

    /** Packages being cloned right now, for the picker's "Cloning…" state. */
    var cloning by mutableStateOf<Set<String>>(emptySet()); private set

    private fun say(s: String) { _messages.tryEmit(s) }

    fun refresh() = viewModelScope.launch {
        if (!VirtualEngine.isReady) return@launch
        runCatching {
            withContext(Dispatchers.IO) {
                app.profiles.alignLocaleOnce(java.util.Locale.getDefault().toLanguageTag(), java.util.TimeZone.getDefault().id)
                val list = repo.clones()
                list.forEach { app.health.trim(it.spaceId, it.packageName) }
                list to app.meta.spaces()
            }
        }.onSuccess { (list, spaces) ->
            _clones.value = list
            _spaces.value = spaces
        }.onFailure { say("Could not list clones: ${it.message}") }
    }

    fun loadDeviceApps() = viewModelScope.launch {
        runCatching { repo.deviceApps() }.onSuccess { _deviceApps.value = it }
            .onFailure { _deviceApps.value = emptyList(); say("Could not list your apps: ${it.message}") }
    }

    suspend fun icon(pkg: String, px: Int) = repo.deviceIcon(pkg, px)
    suspend fun cloneIcon(item: CloneItem, px: Int) = repo.cloneIcon(item, px)

    // ---- Clone actions ----------------------------------------------------------------------------

    /** Key of the clone that is starting right now; the UI shows "Opening…" and ignores more taps. */
    var launching by mutableStateOf<String?>(null); private set

    fun launch(item: CloneItem) {
        if (launching != null) return          // a second tap while the first launch is starting does nothing
        launching = item.key
        viewModelScope.launch {
            try {
                val ok = VirtualEngine.launch(item.packageName, item.spaceId)
                if (!ok) {
                    withContext(Dispatchers.IO) { app.health.recordLaunch(item.spaceId, item.packageName, false) }
                    say("${item.displayName} did not start. Try Force stop, then open it again.")
                } else {
                    delay(1500)                // keep the indicator until the clone's first screen covers ours
                }
            } finally {
                launching = null
                refresh()
            }
        }
    }

    // ---- Diagnostics ------------------------------------------------------------------------------

    /** Time of the last crash of the app itself, 0 when there is none to show. */
    var hostCrashAt by mutableStateOf(0L); private set

    fun checkHostCrash() = viewModelScope.launch(Dispatchers.IO) { hostCrashAt = app.crashes.hostCrashedAt() }
    fun dismissHostCrash() = viewModelScope.launch(Dispatchers.IO) { app.crashes.clearHost(); hostCrashAt = 0L }

    suspend fun cloneCrash(item: CloneItem): String? = withContext(Dispatchers.IO) { app.crashes.clone(item.spaceId, item.packageName) }

    suspend fun diagnosticReport(): String = withContext(Dispatchers.IO) {
        app.crashes.report("${app.packageManager.getPackageInfo(app.packageName, 0).versionName} (${app.packageName})", _clones.value)
    }

    /** Clones [pkg] into existing [spaceIds] plus [newSpaces] fresh spaces (batch clone). */
    fun clone(pkg: String, label: String, spaceIds: List<Int>, newSpaces: Int) = viewModelScope.launch {
        cloning = cloning + pkg
        try {
            val targets = spaceIds.toMutableList()
            if (newSpaces > 0) targets += repo.newSpaces(newSpaces).map { it.id }
            var okCount = 0; var firstError: String? = null
            repo.cloneInto(pkg, targets) { done, total, err ->
                busy = "Cloning $label ($done of $total)"
                if (err == null) okCount++ else if (firstError == null) firstError = err
            }
            say(if (okCount == targets.size) "Cloned $label into $okCount space(s)" else "Cloned $okCount of ${targets.size}. ${firstError ?: ""}".trim())
        } catch (t: Throwable) {
            say("Could not clone $label: ${t.message ?: t.javaClass.simpleName}")
        } finally {
            cloning = cloning - pkg; busy = null; refresh()
        }
    }

    fun remove(item: CloneItem) = viewModelScope.launch {
        runCatching { repo.remove(item); withContext(Dispatchers.IO) { app.crashes.delete(item.spaceId, item.packageName) } }
            .onFailure { say("Could not remove ${item.displayName}: ${it.message}") }
        refresh()
    }

    fun clearData(item: CloneItem) = viewModelScope.launch {
        runCatching { VirtualEngine.forceStop(item.packageName, item.spaceId); VirtualEngine.clearData(item.packageName, item.spaceId) }
            .onSuccess { say("Cleared data of ${item.displayName}") }.onFailure { say("Could not clear data: ${it.message}") }
    }

    fun forceStop(item: CloneItem) = viewModelScope.launch {
        runCatching { VirtualEngine.forceStop(item.packageName, item.spaceId) }
            .onSuccess { say("Stopped ${item.displayName}") }.onFailure { say("Could not stop: ${it.message}") }
    }

    fun rename(item: CloneItem, name: String?) = viewModelScope.launch(Dispatchers.IO) {
        app.meta.setMeta(item.spaceId, item.packageName, item.meta.copy(customName = name?.trim()?.takeIf { it.isNotEmpty() }))
        refresh()
    }

    fun setMeta(item: CloneItem, meta: CloneMeta) = viewModelScope.launch(Dispatchers.IO) {
        app.meta.setMeta(item.spaceId, item.packageName, meta); refresh()
    }

    fun renameSpace(id: Int, name: String) = viewModelScope.launch(Dispatchers.IO) { app.meta.renameSpace(id, name); refresh() }

    fun addSpace() = viewModelScope.launch {
        runCatching { repo.newSpaces(1).first() }.onSuccess { say("Created ${it.name}") }.onFailure { say("Could not create a space: ${it.message}") }
        refresh()
    }

    fun removeSpace(id: Int) = viewModelScope.launch {
        runCatching { repo.removeSpace(id) }.onFailure { say("Could not delete the space: ${it.message}") }
        if (spaceFilter == id) spaceFilter = null
        refresh()
    }

    fun pinShortcut(ctx: Context, item: CloneItem) = viewModelScope.launch {
        if (!ShortcutSupport.canPin(ctx)) { say("This launcher does not support pinned shortcuts"); return@launch }
        runCatching { ShortcutSupport.requestPin(ctx, item, repo.cloneIcon(item, 192)) }
            .onFailure { say("Could not add the shortcut: ${it.message}") }
    }

    // ---- Backup and restore (Storage Access Framework streams, no storage permission) -----------------

    fun backup(item: CloneItem, ctx: Context, uri: Uri) = viewModelScope.launch {
        busy = "Backing up ${item.displayName}"
        try {
            withContext(Dispatchers.IO) {
                VirtualEngine.forceStop(item.packageName, item.spaceId)
                val dirs = VirtualEngine.dataDirs(ctx, item.packageName, item.spaceId)
                val out = ctx.contentResolver.openOutputStream(uri) ?: error("Could not open the file")
                out.use { BackupManager.backup(it, item.packageName, item.spaceId, dirs, app.profiles.export(item.spaceId, item.packageName)) }
            }
            say("Backup saved")
        } catch (t: Throwable) { say("Backup failed: ${t.message}") } finally { busy = null }
    }

    fun restore(item: CloneItem, ctx: Context, uri: Uri) = viewModelScope.launch {
        busy = "Restoring ${item.displayName}"
        try {
            val r = withContext(Dispatchers.IO) {
                VirtualEngine.forceStop(item.packageName, item.spaceId)
                val dirs = VirtualEngine.dataDirs(ctx, item.packageName, item.spaceId)
                val input = ctx.contentResolver.openInputStream(uri) ?: error("Could not open the file")
                input.use { BackupManager.restore(it, item.packageName, dirs, File(ctx.cacheDir, "restore-staging")) }
            }
            say(if (r.isSuccess) "Restored ${item.displayName}" else "Restore refused: ${r.exceptionOrNull()?.message}")
        } catch (t: Throwable) { say("Restore failed: ${t.message}") } finally { busy = null }
    }

    // ---- Profile and proxy -------------------------------------------------------------------------

    fun profile(item: CloneItem): DeviceProfile =
        app.profiles.ensure(item.spaceId, item.packageName, Build.VERSION.SDK_INT, Build.VERSION.RELEASE)

    fun regenerate(item: CloneItem, newDevice: Boolean): DeviceProfile? = app.profiles.regenerate(item.spaceId, item.packageName, newDevice)
    fun setLocked(item: CloneItem, locked: Boolean) = app.profiles.setLocked(item.spaceId, item.packageName, locked)
    fun updateProfile(item: CloneItem, t: (DeviceProfile) -> DeviceProfile) = app.profiles.update(item.spaceId, item.packageName, t)
    fun exportProfile(item: CloneItem): String? = app.profiles.export(item.spaceId, item.packageName)
    fun importProfile(item: CloneItem, json: String) = app.profiles.import(item.spaceId, item.packageName, json)

    fun proxy(item: CloneItem): ProxyConfig = app.proxies.load(item.spaceId, item.packageName)
    /**
     * Saves the proxy. With "match proxy location" on, also looks up where the proxy exits and sets
     * the clone's GPS position, time zone and language to that place. Turning it off again restores
     * the phone's language and time zone and the real GPS. Returns the config as stored.
     */
    suspend fun saveProxy(item: CloneItem, cfg: ProxyConfig): ProxyConfig {
        busy = "Saving network settings"
        try {
            val before = withContext(Dispatchers.IO) { app.proxies.load(item.spaceId, item.packageName) }
            var stored = cfg
            var note = "Saved. ${item.displayName} uses the new settings next time it starts."
            if (cfg.matchLocation && cfg.isUsable) {
                busy = "Finding where the proxy exits"
                val found = ProxyTester.locate(cfg)
                if (found == null) {
                    stored = cfg.copy(geo = null)
                    note = "Saved, but the proxy's location could not be found, so GPS, time zone and language were left as they are. Check the proxy and save again."
                } else {
                    // Keep the same spot while the proxy still exits in the same city, so the clone does not jump around.
                    val old = before.geo?.takeIf { before.matchLocation && it.city == found.city && it.country == found.country }
                    val geo = old?.copy(ip = found.ip) ?: found.jittered(Math.random(), Math.random())
                    stored = cfg.copy(geo = geo)
                    withContext(Dispatchers.IO) { app.profiles.update(item.spaceId, item.packageName) { it.copy(locale = geo.locale, timezone = geo.timezone) } }
                    val gps = VirtualEngine.setLocation(item.packageName, item.spaceId, geo.latitude, geo.longitude)
                    note = "Saved. ${item.displayName} now reports ${geo.summary}" + if (gps) "." else ", but the GPS position could not be set."
                }
            } else {
                stored = cfg.copy(matchLocation = cfg.matchLocation && cfg.isUsable, geo = null)
                if (before.matchLocation) {
                    withContext(Dispatchers.IO) {
                        app.profiles.update(item.spaceId, item.packageName) {
                            it.copy(locale = java.util.Locale.getDefault().toLanguageTag(), timezone = java.util.TimeZone.getDefault().id)
                        }
                    }
                    VirtualEngine.clearLocation(item.packageName, item.spaceId)
                    note = "Saved. ${item.displayName} is back on your phone's language, time zone and real GPS."
                }
            }
            withContext(Dispatchers.IO) { app.proxies.save(item.spaceId, item.packageName, stored) }
            runCatching { VirtualEngine.forceStop(item.packageName, item.spaceId) }
            say(note)
            return stored
        } catch (t: Throwable) {
            say("Could not save: ${t.message ?: t.javaClass.simpleName}")
            return cfg
        } finally {
            busy = null
        }
    }

    suspend fun testProxy(cfg: ProxyConfig) = ProxyTester.test(cfg)

    fun runLeakTest(item: CloneItem) = viewModelScope.launch {
        leak = LeakTestRunner.State.Running("Starting")
        leak = try {
            leakRunner.run(item) { step -> leak = LeakTestRunner.State.Running(step) }
        } catch (t: Throwable) {
            LeakTestRunner.State.Failed("The test could not finish: ${t.message ?: t.javaClass.simpleName}")
        }
    }

    fun resetLeak() { leak = LeakTestRunner.State.Idle }

    // ---- Google Play services ---------------------------------------------------------------------------

    fun installGms(space: Int) = viewModelScope.launch {
        busy = "Installing Google Play services"
        val r = try { VirtualEngine.installGms(space) } finally { busy = null }
        say(if (r.ok) "Google Play services installed in this space" else "Could not install: ${r.message}")
    }

    fun gmsSupported() = VirtualEngine.gmsSupported()
}
