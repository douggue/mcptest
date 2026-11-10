package app.clonespace.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.clonespace.data.CloneItem
import app.clonespace.data.Health
import java.text.DateFormat
import java.util.Date

private enum class Confirm { REMOVE, CLEAR, REMOVE_SPACE }

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun HomeScreen(vm: MainViewModel, onPick: () -> Unit, onIdentity: (CloneItem) -> Unit, onLeak: (CloneItem) -> Unit) {
    val ctx = LocalContext.current
    val clones by vm.clones.collectAsState()
    val spaces by vm.spaces.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(Unit) { vm.messages.collect { snackbar.showSnackbar(it) } }

    var menuFor by remember { mutableStateOf<CloneItem?>(null) }
    var rename by remember { mutableStateOf<CloneItem?>(null) }
    var confirm by remember { mutableStateOf<Pair<Confirm, Any>?>(null) }
    var spaceRename by remember { mutableStateOf<Int?>(null) }
    var pendingBackup by remember { mutableStateOf<CloneItem?>(null) }
    var pendingRestore by remember { mutableStateOf<CloneItem?>(null) }

    val backupPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
        val item = pendingBackup; pendingBackup = null
        if (uri != null && item != null) vm.backup(item, ctx, uri)
    }
    val restorePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val item = pendingRestore; pendingRestore = null
        if (uri != null && item != null) vm.restore(item, ctx, uri)
    }

    val filter = vm.spaceFilter
    val shownSpaces = spaces.filter { filter == null || it.id == filter }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            ExtendedFloatingActionButton(onClick = onPick, containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary) {
                Icon(Icons.Filled.Add, null); Text("  Clone an app", style = MaterialTheme.typography.labelLarge)
            }
        },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad)) {
            Text("CloneSpace", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(start = 20.dp, top = 16.dp, end = 20.dp))
            Text("Separate copies of your apps, each with its own data.", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))

            LazyRow(Modifier.padding(vertical = 8.dp), contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item { FilterChip(selected = filter == null, onClick = { vm.spaceFilter = null }, label = { Text("All") }, modifier = Modifier.height(36.dp)) }
                items(spaces) { s ->
                    FilterChip(selected = filter == s.id, onClick = { vm.spaceFilter = s.id }, label = { Text(s.name) }, modifier = Modifier.height(36.dp))
                }
                item {
                    Box(
                        Modifier.height(36.dp).dashedBorder(MaterialTheme.colorScheme.outline).clickable { vm.addSpace() }.padding(horizontal = 14.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text("+ New space", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary) }
                }
            }

            vm.busy?.let { msg ->
                Row(Modifier.padding(horizontal = 20.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp); Text(msg, style = MaterialTheme.typography.bodySmall)
                }
            }

            if (clones.isEmpty() && vm.busy == null) {
                Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("No clones yet", style = MaterialTheme.typography.titleMedium)
                    Text("Tap “Clone an app” to make a second copy of an app you already use.", textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(4), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 96.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    for (space in shownSpaces) {
                        val inSpace = clones.filter { it.spaceId == space.id }
                        item(key = "h${space.id}", span = { GridItemSpan(maxLineSpan) }) {
                            Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(space.name, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                                TextButton(onClick = { spaceRename = space.id }) { Text("Rename") }
                                TextButton(onClick = { confirm = Confirm.REMOVE_SPACE to space.id }) { Text("Delete") }
                            }
                        }
                        if (inSpace.isEmpty()) {
                            item(key = "e${space.id}", span = { GridItemSpan(maxLineSpan) }) {
                                Text("Empty space", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        items(inSpace, key = { it.key }) { item ->
                            CloneTile(vm, item, onClick = { vm.launch(item) }, onLongClick = { menuFor = item })
                        }
                    }
                }
            }
        }
    }

    // ---- Long-press menu --------------------------------------------------------------------------
    menuFor?.let { item ->
        ModalBottomSheet(onDismissRequest = { menuFor = null }) {
            Column(Modifier.padding(bottom = 24.dp)) {
                Text(item.displayName + "  ·  " + item.spaceName, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 20.dp))
                Text(healthText(item.health), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                @Composable fun action(label: String, danger: Boolean = false, run: () -> Unit) {
                    Text(label, style = MaterialTheme.typography.bodyLarge,
                        color = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.fillMaxWidth().clickable { menuFor = null; run() }.padding(horizontal = 20.dp, vertical = 14.dp))
                }
                action("Open") { vm.launch(item) }
                action("Identity and network") { onIdentity(item) }
                action("Run leak test") { onLeak(item) }
                action("Rename") { rename = item }
                action("Add home-screen shortcut") { vm.pinShortcut(ctx, item) }
                action("Back up data to a file") { pendingBackup = item; backupPicker.launch("${item.packageName}-${item.spaceId}.clonespace.zip") }
                action("Restore data from a file") { pendingRestore = item; restorePicker.launch(arrayOf("application/zip", "application/octet-stream")) }
                action("Force stop") { vm.forceStop(item) }
                action("Clear data", danger = true) { confirm = Confirm.CLEAR to item }
                action("Remove", danger = true) { confirm = Confirm.REMOVE to item }
            }
        }
    }

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
                        Confirm.REMOVE -> vm.remove(target as CloneItem)
                        Confirm.CLEAR -> vm.clearData(target as CloneItem)
                        Confirm.REMOVE_SPACE -> vm.removeSpace(target as Int)
                    }
                    confirm = null
                }) { Text("Continue") }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancel") } },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun CloneTile(vm: MainViewModel, item: CloneItem, onClick: () -> Unit, onLongClick: () -> Unit) {
    val icon = rememberBitmap(item.key to item.meta.badgeColor) { vm.cloneIcon(item, 144) }
    Column(
        Modifier.combinedClickable(onClick = onClick, onLongClick = onLongClick).padding(vertical = 4.dp).height(104.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        IconTile(icon, number = item.number, badgeColor = colorOf(item.meta.badgeColor), degraded = item.health.isDegraded, degradedText = healthText(item.health))
        Text(item.displayName, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
    }
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
