package app.clonespace.ui

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.clonespace.data.CloneItem
import app.clonespace.profile.DeviceProfile
import app.clonespace.profile.ProfileGenerator
import app.clonespace.profile.Templates
import app.clonespace.proxy.ProxyConfig
import app.clonespace.proxy.ProxyTester
import app.clonespace.proxy.ProxyType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun ProfileScreen(vm: MainViewModel, item: CloneItem, onBack: () -> Unit, onLeak: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var profile by remember { mutableStateOf<DeviceProfile?>(null) }
    var proxy by remember { mutableStateOf(ProxyConfig()) }
    var test by remember { mutableStateOf<ProxyTester.Result?>(null) }
    var testing by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var meta by remember { mutableStateOf(item.meta) }

    LaunchedEffect(item.key) {
        withContext(Dispatchers.IO) { profile = vm.profile(item); proxy = vm.proxy(item) }
    }
    LaunchedEffect(Unit) { vm.messages.collect { notice = it } }

    val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) scope.launch(Dispatchers.IO) {
            val json = vm.exportProfile(item) ?: return@launch
            ctx.contentResolver.openOutputStream(uri)?.use { it.write(json.toByteArray()) }
            notice = "Profile exported"
        }
    }
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch(Dispatchers.IO) {
            val json = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) } ?: return@launch
            val r = vm.importProfile(item, json)
            if (r.isSuccess) { profile = r.getOrNull(); notice = "Profile imported" } else notice = "Not imported: ${r.exceptionOrNull()?.message}"
        }
    }

    fun edit(t: (DeviceProfile) -> DeviceProfile) { scope.launch(Dispatchers.IO) { profile = vm.updateProfile(item, t) } }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = { TopAppBar(title = { Text("${item.displayName} · ${item.spaceName}") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }) },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            notice?.let { Banner(it) }
            val p = profile
            if (p == null) Text("Loading…") else {
                // ---- Identity ------------------------------------------------------------------------------------
                SectionCard("Identity") {
                    Banner("Each clone gets its own device identity so accounts stay separate. The device and its IDs are generated. Language and time zone follow your phone unless you pick another region.")
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("Device model", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        Picker(Templates.all.map { it.id to "${it.brand.replaceFirstChar(Char::uppercase)} ${it.model}" }, p.templateId, enabled = !p.locked) { id ->
                            edit { old -> ProfileGenerator.generate(old.sdkInt, old.release, id, old.regionCode, locale = old.locale, timezone = old.timezone).copy(locked = old.locked, spoofScreen = old.spoofScreen) }
                        }
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("Region", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        Picker(Templates.regions.map { it.code to "${it.code} · ${it.locale}" }, p.regionCode, enabled = !p.locked) { code ->
                            // With "Match proxy location" on, language and time zone stay the proxy's; the region sets the rest.
                            val g = proxy.geo?.takeIf { proxy.matchLocation && proxy.enabled }
                            edit { old -> ProfileGenerator.generate(old.sdkInt, old.release, old.templateId, code, locale = g?.locale, timezone = g?.timezone).copy(locked = old.locked, spoofScreen = old.spoofScreen) }
                        }
                    }
                    KV("Android ID", p.androidId); KV("Advertising ID", p.advertisingId); KV("GSF ID", p.gsfId)
                    KV("IMEI", p.imei); KV("IMSI", p.imsi); KV("Wi-Fi MAC", p.wifiMac)
                    KV("Model", "${p.manufacturer} ${p.model}"); KV("Fingerprint", p.fingerprint)
                    KV("Build", "${p.buildId} · patch ${p.securityPatch}"); KV("Hardware", "${p.hardware} / ${p.board} / ${p.bootloader}")
                    KV("SIM", "${p.simOperatorName} ${p.simOperator} ${p.simCountryIso}"); KV("Locale / zone", "${p.locale} · ${p.timezone}")
                    KV("Android", "${p.release} (API ${p.sdkInt}), real value, never faked")
                    KV("Sensors", "${p.sensors.size} (stored, not applied yet)")
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { scope.launch(Dispatchers.IO) { profile = vm.regenerate(item, false) } }, enabled = !p.locked, modifier = Modifier.heightIn(min = 44.dp)) { Text("Regenerate IDs") }
                        OutlinedButton(onClick = { scope.launch(Dispatchers.IO) { profile = vm.regenerate(item, true) } }, enabled = !p.locked, modifier = Modifier.heightIn(min = 44.dp)) { Text("New device") }
                        OutlinedButton(onClick = { exporter.launch("${item.packageName}-profile.json") }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Export") }
                        OutlinedButton(onClick = { importer.launch(arrayOf("application/json", "application/octet-stream", "text/plain")) }, enabled = !p.locked, modifier = Modifier.heightIn(min = 44.dp)) { Text("Import") }
                    }
                    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Lock identity", style = MaterialTheme.typography.bodyMedium)
                            Text("Keeps this identity fixed so the account does not see a new device.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(p.locked, { v -> scope.launch(Dispatchers.IO) { profile = vm.setLocked(item, v) } })
                    }
                    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Report this model's screen", style = MaterialTheme.typography.bodyMedium)
                            Text("Changes density and size the app sees. Can break layouts, off by default.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(p.spoofScreen, { v -> edit { it.copy(spoofScreen = v) } })
                    }
                }

                // ---- Appearance --------------------------------------------------------------------------------
                SectionCard("Name, badge and notifications") {
                    var name by remember(item.key) { mutableStateOf(meta.customName.orEmpty()) }
                    var label by remember(item.key) { mutableStateOf(meta.notificationLabel.orEmpty()) }
                    OutlinedTextField(name, { name = it.take(32) }, label = { Text("Custom name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(label, { label = it.take(32) }, label = { Text("Notification label (default: ${item.spaceName})") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Text("Badge colour", style = MaterialTheme.typography.labelMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        for (c in BadgeColors) {
                            Box(Modifier.size(44.dp).clickable { meta = meta.copy(badgeColor = c) }, contentAlignment = Alignment.Center) {
                                Box(Modifier.size(32.dp).background(Color(c), CircleShape).border(if (meta.badgeColor == c) 3.dp else 0.dp, MaterialTheme.colorScheme.onSurface, CircleShape))
                            }
                        }
                    }
                    Button(onClick = {
                        meta = meta.copy(customName = name.trim().ifEmpty { null }, notificationLabel = label.trim().ifEmpty { null })
                        vm.setMeta(item, meta); notice = "Saved. Notification changes apply the next time the clone starts."
                    }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Save") }
                }

                // ---- Proxy ----------------------------------------------------------------------------------------
                SectionCard("Network proxy") {
                    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Use a proxy for this clone", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        Switch(proxy.enabled, { proxy = proxy.copy(enabled = it) })
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ProxyType.entries.forEach { t ->
                            FilterChip(proxy.type == t, { proxy = proxy.copy(type = t) }, label = { Text(if (t == ProxyType.SOCKS5) "SOCKS5" else "HTTP") }, modifier = Modifier.heightIn(min = 36.dp))
                        }
                    }
                    OutlinedTextField(proxy.host, { proxy = proxy.copy(host = it.trim()) }, label = { Text("Host") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(if (proxy.port == 0) "" else proxy.port.toString(), { proxy = proxy.copy(port = it.filter(Char::isDigit).take(5).toIntOrNull() ?: 0) },
                        label = { Text("Port") }, singleLine = true, keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(proxy.username, { proxy = proxy.copy(username = it) }, label = { Text("Username (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(proxy.password, { proxy = proxy.copy(password = it) }, label = { Text("Password (optional)") }, singleLine = true,
                        visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Block UDP", style = MaterialTheme.typography.bodyMedium)
                            Text("Stops QUIC and other UDP from going around the proxy. Apps fall back to TCP.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(proxy.blockUdp, { proxy = proxy.copy(blockUdp = it) })
                    }
                    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Match proxy location", style = MaterialTheme.typography.bodyMedium)
                            Text("Sets this clone's GPS, time zone and language to the place the proxy exits. Looks the proxy's address up once at ipwho.is, through the proxy.",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(proxy.matchLocation && proxy.enabled, { proxy = proxy.copy(matchLocation = it) }, enabled = proxy.enabled)
                    }
                    if (proxy.matchLocation && proxy.enabled) {
                        val g = proxy.geo
                        Banner(if (g != null) "Clone reports: ${g.summary}" else "The location is looked up when you save.")
                    }
                    OutlinedButton(onClick = { testing = true; test = null; scope.launch { test = vm.testProxy(proxy); testing = false } }, enabled = !testing && proxy.host.isNotBlank(), modifier = Modifier.heightIn(min = 44.dp)) {
                        Text(if (testing) "Testing…" else "Test connection")
                    }
                    test?.let { r ->
                        if (r.ok) Banner("Connected in ${r.latencyMs} ms. Exit IP ${r.exitIp}.") else Banner("Failed: ${r.error}", warning = true)
                    }
                    Banner("Password is stored on this phone in the app's private storage and is never sent anywhere except to your proxy.")
                    var saving by remember { mutableStateOf(false) }
                    Button(onClick = {
                        saving = true
                        scope.launch {
                            proxy = vm.saveProxy(item, proxy)
                            profile = withContext(Dispatchers.IO) { vm.profile(item) }   // language and time zone may have changed
                            saving = false
                        }
                    }, enabled = !saving, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text(if (saving) "Saving…" else "Save and restart clone") }
                    // Also here: the banner at the top of the page is off screen when this button is pressed.
                    if (!saving) notice?.let { Banner(it) }
                }

                OutlinedButton(onClick = onLeak, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text("Run leak test") }
            }
        }
    }
}

@Composable
private fun KV(k: String, v: String) {
    Column {
        Text(k, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        MonoText(v, maxLines = 3)
    }
}

@Composable
private fun Picker(options: List<Pair<String, String>>, selected: String, enabled: Boolean, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }, enabled = enabled, modifier = Modifier.heightIn(min = 44.dp)) { Text(options.firstOrNull { it.first == selected }?.second ?: selected) }
        DropdownMenu(open, { open = false }) {
            options.forEach { (id, label) -> DropdownMenuItem(text = { Text(label) }, onClick = { open = false; if (id != selected) onSelect(id) }) }
        }
    }
}
