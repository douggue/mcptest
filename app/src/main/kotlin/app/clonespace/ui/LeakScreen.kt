package app.clonespace.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.clonespace.data.CloneItem
import app.clonespace.data.LeakAnalyzer
import app.clonespace.data.LeakRow
import app.clonespace.data.LeakStatus
import app.clonespace.data.LeakTestRunner

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LeakScreen(vm: MainViewModel, item: CloneItem, onBack: () -> Unit) {
    DisposableEffect(item.key) { onDispose { vm.resetLeak() } }
    val state = vm.leak
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = { TopAppBar(title = { Text("Leak test · ${item.displayName}") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }) },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            when (state) {
                is LeakTestRunner.State.Idle -> {
                    Banner("The test starts a small probe app inside this clone with the same identity and proxy, and compares what it sees with what your real phone returns. It contacts 1.1.1.1 once to learn the public IP, and sends no other data anywhere.")
                    Button(onClick = { vm.runLeakTest(item) }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("Run leak test") }
                }
                is LeakTestRunner.State.Running -> {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp); Text(state.step, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                is LeakTestRunner.State.Failed -> {
                    Banner(state.message, warning = true)
                    Button(onClick = { vm.runLeakTest(item) }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("Try again") }
                }
                is LeakTestRunner.State.Done -> {
                    val (iso, leaks, other) = LeakAnalyzer.summary(state.rows)
                    Banner(if (leaks == 0) "No leaks found: $iso checks isolated, $other not applicable or not tested." else "$leaks leak(s) found, $iso isolated, $other not tested. See the rows marked Leak.", warning = leaks > 0)
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(state.rows, key = { it.key }) { Row(it) }
                        item {
                            Button(onClick = { vm.runLeakTest(item) }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(vertical = 8.dp)) { Text("Run again") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Row(r: LeakRow) {
    SectionCard {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(r.label, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            StatusTag(r.status)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f)) {
                Text("Real phone", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                MonoText(r.real.ifEmpty { "-" })
            }
            Column(Modifier.weight(1f)) {
                Text("Clone sees", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                MonoText(r.clone.ifEmpty { "-" })
            }
        }
        r.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}
