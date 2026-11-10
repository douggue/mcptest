package app.clonespace

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.clonespace.data.CloneItem
import app.clonespace.engine.VirtualEngine
import app.clonespace.ui.HomeScreen
import app.clonespace.ui.LeakScreen
import app.clonespace.ui.MainViewModel
import app.clonespace.ui.PickerScreen
import app.clonespace.ui.ProfileScreen
import app.clonespace.ui.theme.CloneSpaceTheme
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // The engine starts on a background thread. The splash screen stays up until it reports ready
        // (or failed), so the UI never touches a half-started engine and never blocks the main thread.
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        splash.setKeepOnScreenCondition { !VirtualEngine.isReady && !VirtualEngine.startupFailed }
        enableEdgeToEdge()
        setContent { CloneSpaceTheme { Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { Root() } } }
    }
}

@Composable
private fun Root() {
    val ctx = androidx.compose.ui.platform.LocalContext.current as ComponentActivity
    var ready by remember { mutableStateOf(VirtualEngine.isReady) }
    var failed by remember { mutableStateOf(VirtualEngine.startupFailed) }
    LaunchedEffect(Unit) {
        while (!VirtualEngine.isReady && !VirtualEngine.startupFailed) delay(100)
        ready = VirtualEngine.isReady; failed = VirtualEngine.startupFailed
    }

    if (failed) {
        Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Text("The clone engine did not start", style = MaterialTheme.typography.titleMedium)
            Text("Close the app completely and open it again. If this keeps happening, your Android version may not be supported yet.",
                style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 12.dp))
            Button(onClick = { failed = false; VirtualEngine.start { ok -> ready = ok; failed = !ok } }) { Text("Try again") }
        }
        return
    }
    if (!ready) return

    val vm: MainViewModel = viewModel(factory = viewModelFactory { initializer { MainViewModel(CloneApp.instance) } })
    val nav = rememberNavController()
    LaunchedEffect(ready) { vm.refresh() }

    // Notifications permission (Android 13+), asked once so clone notifications can show.
    val askNotif = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            askNotif.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    // Android 11+ storage access, only in the sideload build (the Play build never intercepts).
    var storagePrompt by remember { mutableStateOf<Pair<String, Int>?>(null) }
    DisposableEffect(Unit) {
        VirtualEngine.StorageGate.pending = { pkg, space -> storagePrompt = pkg to space }
        onDispose { VirtualEngine.StorageGate.pending = null }
    }
    storagePrompt?.let { (pkg, space) ->
        AlertDialog(
            onDismissRequest = { storagePrompt = null },
            title = { Text("Allow file access?") },
            text = { Text("Many cloned apps need “All files access” to work on Android 11 and newer. You can also open the clone without it, but saving or reading files may fail.") },
            confirmButton = { TextButton(onClick = { storagePrompt = null; VirtualEngine.requestAllFilesAccess(ctx) }) { Text("Open settings") } },
            dismissButton = {
                TextButton(onClick = {
                    storagePrompt = null
                    VirtualEngine.StorageGate.bypassOnce = "$space:$pkg"
                    vm.clones.value.firstOrNull { it.spaceId == space && it.packageName == pkg }?.let { vm.launch(it) }
                }) { Text("Open anyway") }
            },
        )
    }

    fun find(space: Int, pkg: String): CloneItem? = vm.clones.value.firstOrNull { it.spaceId == space && it.packageName == pkg }
    val args = listOf(navArgument("space") { type = NavType.IntType }, navArgument("pkg") { type = NavType.StringType })

    NavHost(nav, startDestination = "home") {
        composable("home") {
            LaunchedEffect(Unit) { vm.refresh() }
            HomeScreen(vm, onPick = { nav.navigate("picker") },
                onIdentity = { nav.navigate("profile/${it.spaceId}/${it.packageName}") },
                onLeak = { nav.navigate("leak/${it.spaceId}/${it.packageName}") })
        }
        composable("picker") { PickerScreen(vm, onBack = { nav.popBackStack() }) }
        composable("profile/{space}/{pkg}", arguments = args) { e ->
            val item = find(e.arguments!!.getInt("space"), e.arguments!!.getString("pkg")!!)
            if (item == null) nav.popBackStack() else ProfileScreen(vm, item, onBack = { nav.popBackStack() }, onLeak = { nav.navigate("leak/${item.spaceId}/${item.packageName}") })
        }
        composable("leak/{space}/{pkg}", arguments = args) { e ->
            val item = find(e.arguments!!.getInt("space"), e.arguments!!.getString("pkg")!!)
            if (item == null) nav.popBackStack() else LeakScreen(vm, item, onBack = { nav.popBackStack() })
        }
    }
}
