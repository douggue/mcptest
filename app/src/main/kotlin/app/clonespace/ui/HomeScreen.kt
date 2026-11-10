package app.clonespace.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.clonespace.data.CloneItem
import app.clonespace.data.Health
import app.clonespace.data.Space
import app.clonespace.ui.theme.tokens
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

private enum class Confirm { REMOVE, CLEAR, REMOVE_SPACE }

private const val COLUMNS = 4

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun HomeScreen(vm: MainViewModel, onPick: () -> Unit, onIdentity: (CloneItem) -> Unit, onLeak: (CloneItem) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val clones by vm.clones.collectAsState()
    val spaces by vm.spaces.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(Unit) { vm.messages.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(Unit) { vm.checkHostCrash() }

    var menuFor by remember { mutableStateOf<CloneItem?>(null) }
    var rename by remember { mutableStateOf<CloneItem?>(null) }
    var confirm by remember { mutableStateOf<Pair<Confirm, Any>?>(null) }
    var spaceRename by remember { mutableStateOf<Int?>(null) }
    var pendingBackup by remember { mutableStateOf<CloneItem?>(null) }
    var pendingRestore by remember { mutableStateOf<CloneItem?>(null) }
    var topMenu by remember { mutableStateOf(false) }
    /** Title and text of the report shown in the diagnostics dialog; text null while it is collected. */
    var report by remember { mutableStateOf<Pair<String, String?>?>(null) }

    val backupPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
        val item = pendingBackup; pendingBackup = null
        if (uri != null && item != null) vm.backup(item, ctx, uri)
    }
    val restorePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val item = pendingRestore; pendingRestore = null
        if (uri != null && item != null) vm.restore(item, ctx, uri)
    }

    fun showFullReport() {
        report = "Problem report" to null
        scope.launch { report = "Problem report" to runCatching { vm.diagnosticReport() }.getOrElse { "Could not collect the report: ${it.message}" } }
    }

    val filter = vm.spaceFilter
    val shownSpaces = spaces.filter { filter == null || it.id == filter }

    Box(Modifier.fillMaxSize()) {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            snackbarHost = { SnackbarHost(snackbar) },
            floatingActionButton = {
                if (clones.isNotEmpty()) {
                    ExtendedFloatingActionButton(
                        onClick = onPick, shape = RoundedCornerShape(20.dp),
                        containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary,
                        icon = { Icon(Icons.Filled.Add, null) }, text = { Text("Clone an app", style = MaterialTheme.typography.labelLarge) },
                    )
                }
            },
        ) { pad ->
            LazyColumn(
                Modifier.fillMaxSize().padding(pad),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 104.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                item(key = "top") {
                    Row(Modifier.fillMaxWidth().padding(start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("CloneSpace", style = MaterialTheme.typography.headlineMedium)
                            Text(summaryLine(clones.size, spaces.size), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Box {
                            IconButton(onClick = { topMenu = true }) { Icon(Icons.Filled.MoreVert, "More") }
                            DropdownMenu(topMenu, { topMenu = false }) {
                                DropdownMenuItem(text = { Text("New space") }, onClick = { topMenu = false; vm.addSpace() })
                                DropdownMenuItem(text = { Text("Report a problem") }, onClick = { topMenu = false; showFullReport() })
                            }
                        }
                    }
                }

                if (vm.hostCrashAt > 0L) {
                    item(key = "crash") {
                        Column(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(MaterialTheme.tokens.warningSoft).padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Text("CloneSpace closed unexpectedly", style = MaterialTheme.typography.titleSmall)
                            Text("The details were saved on this phone. Copy the report and send it to whoever maintains your build so it can be fixed.",
                                style = MaterialTheme.typography.bodySmall)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = { showFullReport() }, modifier = Modifier.heightIn(min = 44.dp)) { Text("View report") }
                                TextButton(onClick = { vm.dismissHostCrash() }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Dismiss") }
                            }
                        }
                    }
                }

                vm.busy?.let { msg ->
                    item(key = "busy") {
                        Column(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(MaterialTheme.tokens.accentSoft).padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Text(msg, style = MaterialTheme.typography.bodyMedium)
                            LinearProgressIndicator(Modifier.fillMaxWidth().clip(RoundedCornerShape(50)))
                        }
                    }
                }

                if (clones.isEmpty() && vm.busy == null) {
                    item(key = "empty") { EmptyState(onPick) }
                } else {
                    if (spaces.size > 1) {
                        item(key = "filter") {
                            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                item { FilterChip(selected = filter == null, onClick = { vm.spaceFilter = null }, label = { Text("All") }, modifier = Modifier.height(40.dp)) }
                                items(spaces, key = { it.id }) { s ->
                                    FilterChip(selected = filter == s.id, onClick = { vm.spaceFilter = s.id }, label = { Text(s.name) }, modifier = Modifier.height(40.dp))
                                }
                            }
                        }
                    }
                    items(shownSpaces, key = { "s${it.id}" }) { space ->
                        SpaceCard(
                            vm, space, clones.filter { it.spaceId == space.id },
                            onOpen = { vm.launch(it) }, onMenu = { menuFor = it },
                            onRename = { spaceRename = space.id }, onDelete = { confirm = Confirm.REMOVE_SPACE to space.id },
                        )
                    }
                }
            }
        }

        // ---- "Opening…" cover: instant feedback, and no second tap while a clone starts --------------
        val opening = vm.launching?.let { key -> clones.firstOrNull { it.key == key } }
        AnimatedVisibility(opening != null, enter = fadeIn(), exit = fadeOut()) {
            Box(
                Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background.copy(alpha = 0.94f))
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    opening?.let { item ->
                        IconTile(rememberBitmap(item.key) { vm.cloneIcon(item, 192) }, size = 84.dp)
                        Text("Opening ${item.displayName}", style = MaterialTheme.typography.titleMedium)
                        Text(item.spaceName, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 3.dp)
                }
            }
        }
    }

    // ---- Clone menu -------------------------------------------------------------------------------
    menuFor?.let { item ->
        ModalBottomSheet(onDismissRequest = { menuFor = null }) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
                Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    IconTile(rememberBitmap(item.key) { vm.cloneIcon(item, 144) }, size = 52.dp)
                    Column(Modifier.weight(1f)) {
                        Text(item.displayName, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(item.spaceName + "  ·  " + healthText(item.health), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                Button(onClick = { menuFor = null; vm.launch(item) }, modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp).heightIn(min = 52.dp)) { Text("Open") }

                @Composable fun group(title: String) {
                    Text(title.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 4.dp))
                }
                @Composable fun action(label: String, hint: String? = null, danger: Boolean = false, run: () -> Unit) {
                    Column(Modifier.fillMaxWidth().clickable { menuFor = null; run() }.heightIn(min = 52.dp).padding(horizontal = 20.dp, vertical = 10.dp), verticalArrangement = Arrangement.Center) {
                        Text(label, style = MaterialTheme.typography.bodyLarge, color = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
                        if (hint != null) Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }

                group("This clone")
                action("Identity and proxy", "Device model, IDs, language, network proxy") { onIdentity(item) }
                action("Rename") { rename = item }
                action("Add to home screen") { vm.pinShortcut(ctx, item) }
                if (vm.gmsSupported()) action("Install Google services here", "Needed by YouTube, Maps and Google sign-in") { vm.installGms(item.spaceId) }

                group("If something is wrong")
                action("Force stop", "Closes the clone completely; open it again afterwards") { vm.forceStop(item) }
                if (item.health.crashes > 0) action("Show last crash", "The error this clone stopped with") {
                    report = "Last crash of ${item.displayName}" to null
                    scope.launch { report = "Last crash of ${item.displayName}" to (vm.cloneCrash(item) ?: "No details were recorded for this crash. Use “Report a problem” from the main screen to collect the log instead.") }
                }
                action("Run leak test", "Checks what this clone can see of your real phone") { onLeak(item) }

                group("Data")
                action("Back up to a file") { pendingBackup = item; backupPicker.launch("${item.packageName}-${item.spaceId}.clonespace.zip") }
                action("Restore from a file") { pendingRestore = item; restorePicker.launch(arrayOf("application/zip", "application/octet-stream")) }
                action("Clear data", "Signs the clone out and deletes its local data", danger = true) { confirm = Confirm.CLEAR to item }
                action("Remove clone", danger = true) { confirm = Confirm.REMOVE to item }
            }
        }
    }

    report?.let { (title, text) -> ReportDialog(ctx, title, text) { report = null } }

    rename?.let { item ->
        TextDialog("Rename clone", item.meta.customName ?: item.label, onDismiss = { rename = null }) { vm.rename(item, it); rename = null }
    }
    spaceRename?.let { id ->
        TextDialog("Rename space", spaces.firstOrNull { it.id == id }?.name ?: "", onDismiss = { spaceRename = null }) { vm.renameSpace(id, it); spaceRename = null }
    }
    confirm?.let { (kind, target) ->
        val (title, body) = when (kind) {
            Confirm.REMOVE -> "Remove clone?" to "Its data in this space is deleted. The original app is not touched."
            Confirm.CLEAR -> "Clear data?" to "Logins and local data of this clone are deleted."
            Confirm.REMOVE_SPACE -> "Delete space?" to "Every clone in it and all their data are deleted."
        }
        AlertDialog(
            onDismissRequest = { confirm = null }, title = { Text(title) }, text = { Text(body) },
            confirmButton = {
                TextButton(onClick = {
                    when (kind) {
                        Confirm.REMOVE -> (target as? CloneItem)?.let { vm.remove(it) }
                        Confirm.CLEAR -> (target as? CloneItem)?.let { vm.clearData(it) }
                        Confirm.REMOVE_SPACE -> (target as? Int)?.let { vm.removeSpace(it) }
                    }
                    confirm = null
                }) { Text("Continue") }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancel") } },
        )
    }
}

private fun summaryLine(clones: Int, spaces: Int): String = when {
    clones == 0 -> "Separate copies of your apps, each with its own data"
    else -> "$clones ${if (clones == 1) "clone" else "clones"} in $spaces ${if (spaces == 1) "space" else "spaces"}"
}

@Composable
private fun EmptyState(onPick: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp))
            .background(Brush.linearGradient(listOf(scheme.primary, scheme.primary.copy(alpha = 0.72f))))
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Run a second copy of any app", style = MaterialTheme.typography.titleLarge, color = scheme.onPrimary)
        Text("Each clone keeps its own login and data, and can have its own device identity and proxy. Your original apps are never changed.",
            style = MaterialTheme.typography.bodyMedium, color = scheme.onPrimary.copy(alpha = 0.9f))
        Spacer(Modifier.height(4.dp))
        Row(
            Modifier.clip(RoundedCornerShape(16.dp)).background(scheme.onPrimary).clickable(onClick = onPick).heightIn(min = 52.dp).padding(horizontal = 20.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.Filled.Add, null, tint = scheme.primary)
            Text("Clone your first app", style = MaterialTheme.typography.labelLarge, color = scheme.primary)
        }
    }
}

/** One space as a card: name, count, its own menu, and the clones in rows of four. */
@Composable
private fun SpaceCard(
    vm: MainViewModel, space: Space, inSpace: List<CloneItem>,
    onOpen: (CloneItem) -> Unit, onMenu: (CloneItem) -> Unit, onRename: () -> Unit, onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(MaterialTheme.colorScheme.surface)
            .padding(start = 12.dp, end = 4.dp, top = 6.dp, bottom = 12.dp),
    ) {
        Row(Modifier.fillMaxWidth().padding(start = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(space.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Spacer(Modifier.width(8.dp))
            Text(inSpace.size.toString(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 8.dp, vertical = 2.dp))
            Spacer(Modifier.weight(1f))
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "Space options", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem(text = { Text("Rename space") }, onClick = { menu = false; onRename() })
                    DropdownMenuItem(text = { Text("Delete space", color = MaterialTheme.colorScheme.error) }, onClick = { menu = false; onDelete() })
                }
            }
        }
        if (inSpace.isEmpty()) {
            Text("Nothing here yet. Use “Clone an app” and pick this space.", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 6.dp, end = 12.dp, top = 4.dp, bottom = 8.dp))
        }
        for (row in inSpace.chunked(COLUMNS)) {
            Row(Modifier.fillMaxWidth().padding(end = 8.dp)) {
                for (item in row) Box(Modifier.weight(1f)) { CloneTile(vm, item, onClick = { onOpen(item) }, onLongClick = { onMenu(item) }) }
                repeat(COLUMNS - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun CloneTile(vm: MainViewModel, item: CloneItem, onClick: () -> Unit, onLongClick: () -> Unit) {
    val icon = rememberBitmap(item.key) { vm.cloneIcon(item, 144) }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
            .combinedClickable(onClick = onClick, onLongClick = onLongClick, onLongClickLabel = "Options")
            .padding(top = 10.dp, bottom = 8.dp).heightIn(min = 100.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        IconTile(icon, number = item.number, badgeColor = colorOf(item.meta.badgeColor), degraded = item.health.isDegraded, degradedText = healthText(item.health))
        Text(item.displayName, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 2.dp))
    }
}

/** Shows a report (crash or full diagnostics) with Copy and Share. Nothing is sent anywhere by the app itself. */
@Composable
private fun ReportDialog(ctx: Context, title: String, text: String?, onClose: () -> Unit) {
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(title) },
        text = {
            if (text == null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp); Text("Collecting…")
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Stays on this phone unless you copy or share it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Box(Modifier.heightIn(max = 320.dp).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceVariant).verticalScroll(rememberScrollState()).padding(10.dp)) {
                        MonoText(text.take(6000), maxLines = Int.MAX_VALUE)
                    }
                }
            }
        },
        confirmButton = {
            if (text != null) Button(onClick = {
                runCatching {
                    // Clipboard and share intents fail above roughly 500 KB; the report is capped well below that.
                    val clip = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clip.setPrimaryClip(ClipData.newPlainText("CloneSpace report", text.takeLast(90_000)))
                }
                onClose()
            }) { Text("Copy") }
        },
        dismissButton = {
            Row {
                if (text != null) TextButton(onClick = {
                    runCatching {
                        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text.takeLast(90_000))
                        ctx.startActivity(Intent.createChooser(send, "Share report").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                }) { Text("Share") }
                TextButton(onClick = onClose) { Text("Close") }
            }
        },
    )
}

internal fun healthText(h: Health): String {
    if (h.lastLaunchOk == null && h.crashes == 0) return "Not launched yet"
    val df = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
    val last = when (h.lastLaunchOk) {
        true -> "Last launch OK, ${df.format(Date(h.lastLaunchAt))}"
        false -> "Last launch failed, ${df.format(Date(h.lastLaunchAt))}"
        null -> "No launch recorded"
    }
    return if (h.crashes > 0) "$last. Crashed ${h.crashes} time(s) since." else "$last. No crashes."
}

@Composable
fun TextDialog(title: String, initial: String, onDismiss: () -> Unit, onOk: (String) -> Unit) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss, title = { Text(title) },
        text = { OutlinedTextField(text, { text = it.take(32) }, singleLine = true) },
        confirmButton = { TextButton(onClick = { onOk(text) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
