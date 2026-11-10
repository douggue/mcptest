package app.clonespace

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import app.clonespace.data.ShortcutParser
import app.clonespace.engine.VirtualEngine
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Entry point for home-screen shortcuts. Exported so launchers can start it, which is why it checks
 * the package name and space ID itself and only launches something that is really installed in that
 * space, before it touches the engine. Has no UI of its own.
 */
class ShortcutActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val target = ShortcutParser.parse(intent?.dataString)
        if (target == null) { finish(); return }
        lifecycleScope.launch {
            // The engine starts on a background thread; wait for it instead of blocking.
            var waited = 0
            while (!VirtualEngine.isReady && !VirtualEngine.startupFailed && waited < 20_000) { delay(100); waited += 100 }
            val ok = VirtualEngine.isReady &&
                target.spaceId in VirtualEngine.spaceIds() &&
                VirtualEngine.isInstalled(target.packageName, target.spaceId) &&
                VirtualEngine.launch(target.packageName, target.spaceId)
            if (!ok) Toast.makeText(this@ShortcutActivity, R.string.shortcut_gone, Toast.LENGTH_LONG).show()
            finish()
        }
    }
}
