package app.clonespace.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.clonespace.data.DeviceApp
import app.clonespace.data.Support

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PickerScreen(vm: MainViewModel, onBack: () -> Unit) {
    val apps by vm.deviceApps.collectAsState()
    val spaces by vm.spaces.collectAsState()
    val clones by vm.clones.collectAsState()
    var query by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(setOf<Int>()) }
    var newSpaces by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { vm.loadDeviceApps() }
    // Default target: the first space, or one new space when none exists yet.
    LaunchedEffect(spaces) { if (selected.isEmpty() && newSpaces == 0) { if (spaces.isNotEmpty()) selected = setOf(spaces.first().id) else newSpaces = 1 } }

    val targetCount = selected.size + newSpaces

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = { TopAppBar(title = { Text("Clone an app") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }) },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(query, { query = it }, singleLine = true, placeholder = { Text("Search apps") }, modifier = Modifier.fillMaxWidth())

            Text("Clone into", style = MaterialTheme.typography.labelLarge)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(spaces) { s ->
                    FilterChip(selected = s.id in selected, onClick = { selected = if (s.id in selected) selected - s.id else selected + s.id },
                        label = { Text(s.name) }, modifier = Modifier.heightIn(min = 36.dp))
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("New spaces", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                OutlinedButton(onClick = { if (newSpaces > 0) newSpaces-- }, contentPadding = PaddingValues(0.dp), modifier = Modifier.heightIn(min = 44.dp)) { Text("−") }
                Text(newSpaces.toString(), style = MaterialTheme.typography.titleSmall)
                OutlinedButton(onClick = { if (newSpaces < 9) newSpaces++ }, contentPadding = PaddingValues(0.dp), modifier = Modifier.heightIn(min = 44.dp)) { Text("+") }
            }
            Banner("Some apps, including WhatsApp, Instagram and many games, forbid running copies in their terms of service and may ban accounts. Clone only apps you are allowed to.", warning = true)

            val list = apps
            if (list == null) {
                Text("Loading apps…", style = MaterialTheme.typography.bodyMedium)
            } else {
                val shown = list.filter { it.label.contains(query, ignoreCase = true) }
                LazyColumn(verticalArrangement = Arrangement.spacedBy(2.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
                    items(shown, key = { it.packageName }) { app ->
                        val already = clones.count { it.packageName == app.packageName }
                        AppRow(vm, app, already, enabled = targetCount > 0) {
                            vm.clone(app.packageName, app.label, selected.toList(), newSpaces)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AppRow(vm: MainViewModel, app: DeviceApp, existing: Int, enabled: Boolean, onClone: () -> Unit) {
    val icon = rememberBitmap(app.packageName) { vm.icon(app.packageName, 144) }
    val busy = app.packageName in vm.cloning
    Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        IconTile(icon, number = null, size = 48.dp)
        Column(Modifier.weight(1f)) {
            Text(app.label, style = MaterialTheme.typography.bodyLarge, maxLines = 1)
            val note = when (app.support) {
                Support.NO_ARM -> "Not supported: no ARM build"
                Support.SPLIT_APK -> "Split APK, may not work"
                Support.OK -> if (existing > 0) "$existing clone(s) already" else null
            }
            if (note != null) Text(note, style = MaterialTheme.typography.bodySmall,
                color = if (app.support == Support.OK) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error)
        }
        when {
            app.support == Support.NO_ARM -> Text("Not supported", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            busy -> Button(onClick = {}, enabled = false, modifier = Modifier.heightIn(min = 44.dp)) { Text("Cloning…") }
            else -> Button(onClick = onClone, enabled = enabled, modifier = Modifier.heightIn(min = 44.dp),
                colors = ButtonDefaults.buttonColors()) { Text(if (existing > 0) "Clone again" else "Clone") }
        }
    }
}
