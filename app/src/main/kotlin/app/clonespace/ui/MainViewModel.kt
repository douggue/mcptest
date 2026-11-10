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
        runCatching { repo.clones() }.onSuccess { list ->
            _clones.value = list
            _spaces.value = app.meta.spaces()
            list.forEach { app.health.trim(it.spaceId, it.packageName) }
        }.onFailure { say("Could not list clones: ${it.message}") }
    }

    fun loadDeviceApps() = viewModelScope.launch { _deviceApps.value = repo.deviceApps() }

    suspend fun icon(pkg: String, px: Int) = repo.deviceIcon(pkg, px)
    suspend fun cloneIcon(item: CloneItem, px: Int) = repo.cloneIcon(item, px)

    // ---- Clone actions ----------------------------------------------------------------------------

    fun launch(item: CloneItem) = viewModelScope.launch {
        val ok = VirtualEngine.launch(item.packageName, item.spaceId)
        if (!ok) { app.health.recordLaunch(item.spaceId, item.packageName, false); say("${item.displayName} did not start") }
        refresh()
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
        } finally {
            cloning = cloning - pkg; busy = null; refresh()
        }
    }

    fun remove(item: CloneItem) = viewModelScope.launch { repo.remove(item); refresh() }

    fun clearData(item: CloneItem) = viewModelScope.launch {
        VirtualEngine.forceStop(item.packageName, item.spaceId)
        VirtualEngine.clearData(item.packageName, item.spaceId); say("Cleared data of ${item.displayName}")
    }

    fun forceStop(item: CloneItem) = viewModelScope.launch { VirtualEngine.forceStop(item.packageName, item.spaceId); say("Stopped ${item.displayName}") }

    fun rename(item: CloneItem, name: String?) = viewModelScope.launch(Dispatchers.IO) {
        app.meta.setMeta(item.spaceId, item.packageName, item.meta.copy(customName = name?.trim()?.takeIf { it.isNotEmpty() }))
        refresh()
    }

    fun setMeta(item: CloneItem, meta: CloneMeta) = viewModelScope.launch(Dispatchers.IO) {
        app.meta.setMeta(item.spaceId, item.packageName, meta); refresh()
    }

    fun renameSpace(id: Int, name: String) = viewModelScope.launch(Dispatchers.IO) { app.meta.renameSpace(id, name); refresh() }

    fun addSpace() = viewModelScope.launch {
        val s = repo.newSpaces(1).first(); say("Created ${s.name}"); refresh()
    }

    fun removeSpace(id: Int) = viewModelScope.launch { repo.removeSpace(id); if (spaceFilter == id) spaceFilter = null; refresh() }

    fun pinShortcut(ctx: Context, item: CloneItem) = viewModelScope.launch {
        if (!ShortcutSupport.canPin(ctx)) { say("This launcher does not support pinned shortcuts"); return@launch }
        val icon = repo.cloneIcon(item, 192)
        ShortcutSupport.requestPin(ctx, item, icon)
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
    fun saveProxy(item: CloneItem, cfg: ProxyConfig, restart: Boolean) = viewModelScope.launch {
        withContext(Dispatchers.IO) { app.proxies.save(item.spaceId, item.packageName, cfg) }
        if (restart) VirtualEngine.forceStop(item.packageName, item.spaceId)
        say(if (restart) "Saved. ${item.displayName} will use the new settings next time it starts" else "Saved")
    }

    suspend fun testProxy(cfg: ProxyConfig) = ProxyTester.test(cfg)

    fun runLeakTest(item: CloneItem) = viewModelScope.launch {
        leak = LeakTestRunner.State.Running("Starting")
        leak = leakRunner.run(item) { step -> leak = LeakTestRunner.State.Running(step) }
    }

    fun resetLeak() { leak = LeakTestRunner.State.Idle }

    // ---- Google Play services ---------------------------------------------------------------------------

    fun installGms(space: Int) = viewModelScope.launch {
        busy = "Installing Google Play services"
        val r = VirtualEngine.installGms(space)
        busy = null
        say(if (r.ok) "Google Play services installed in this space" else "Could not install: ${r.message}")
    }

    fun gmsSupported() = VirtualEngine.gmsSupported()
}
