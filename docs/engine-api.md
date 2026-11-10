# NewBlackbox API notes (from the source at the pinned commit, with our patches)

These notes come from reading `Bcore/src/main/java/top/niunaijun/blackbox/` after `scripts/fetch-engine.sh`, not from the engine's `Docs.md`, which describes methods that do not exist. Package `top.niunaijun.blackbox`. Only `VirtualEngine.kt` may call `BlackBoxCore`.

## Processes

The host APK runs in several processes and every one of them runs our `Application` class.

| Process | Name | `isMainProcess()` | Purpose |
|---|---|---|---|
| UI | host package | true | Our Compose UI |
| Server | `host:black` (`@string/black_box_service_name`, we override it) | `isServerProcess()` | Virtual package, activity and user managers |
| Clone | `host:p0` … `host:pN` | `isBlackProcess()` is true for the server and clone processes | Target app code plus hooks |

`doAttachBaseContext` decides the type from the process name: equal to the host package means Main, ending in the `black_box_service_name` string means Server, anything else means a clone (BAppClient).

## Startup

```
Application.attachBaseContext(base)
    BlackBoxCore.get().doAttachBaseContext(base, clientConfiguration)   // all processes, sync
    BlackBoxCore.get().addAppLifecycleCallback(callback)                // all processes (callbacks are per process!)
Application.onCreate()
    BlackBoxCore.get().doCreateAsync(readyCallback)                     // patch 0005
```

- `doAttachBaseContext` unseals hidden APIs (HiddenApiBypass after patch 0003), disables resource loading natively, installs the crash handler (`SimpleCrashFix`), starts the daemon service in the server process, and runs `HookManager.get().init()`.
- `doCreate()` (original) calls `ensureBlackProcessInitialized()`, which polls up to 5 times 500 ms for the server process, then `NativeCore.init`, `ServiceManager.initBlackManager()` (binder calls) and `BActivityThread.hookActivityThread()`. This is the blocking part.
- **`doCreateAsync(ReadyCallback)`** (ours): in the UI process it runs `doCreate()` on thread `BlackBoxInit` and posts `onReady(boolean)` on the main thread. In clone and server processes it runs synchronously, because hooks must exist before target code runs. Several callers are all notified. `isCoreReady()` reports completion.
- Do not call engine methods in the UI process before `onReady`. `getService()` returns null or falls back when the server process is not up.

## ClientConfiguration (abstract class you subclass)

| Method | Default | Notes |
|---|---|---|
| `getHostPackageName()` | abstract | Return `context.packageName` |
| `isHideRoot()` | false | |
| `isEnableDaemonService()` | true | Keeps the server process alive with a foreground service |
| `isEnableLauncherActivity()` | true | |
| `isUseVpnNetwork()` | false | Starts `ProxyVpnService` (the plan's optional catch-all VPN). Absent from the Play build |
| `isDisableFlagSecure()` | false | |
| `requestInstallPackage(File, int)` | false | |
| `getLogSenderChatId()` | **null after patch 0001** (was a hard-coded chat id) | Override and keep returning null |

## Public API of `BlackBoxCore`

| Call | Behavior |
|---|---|
| `get()` | Singleton |
| `static getContext()`, `getHostPkg()`, `getHostUid()` | Host values |
| `static getPackageManager()` | The **host's** real `PackageManager`, not the virtual one. Used for the picker and for labels of host apps |
| `isMainProcess()`, `isBlackProcess()`, `isServerProcess()` | Process type |
| `installPackageAsUser(String pkg, int userId)` | **Synchronous and slow.** Reads the host PackageManager `getPackageInfo(pkg, 0)`, so the package must be visible (see `<queries>`), and copies the APK into the virtual user. Returns `InstallResult {success, packageName, msg}`. Refuses to clone the host itself |
| `installPackageAsUser(File apk, int userId)` / `(Uri apk, int)` | Install from a file or URI |
| `uninstallPackageAsUser(pkg, userId)`, `uninstallPackage(pkg)` | Remove one clone, or from all spaces |
| `isInstalled(pkg, userId)` | |
| `launchApk(pkg, userId)` | Returns false if there is no launch intent. On Android 11+ without all-files access it calls `AppLifecycleCallback.onStoragePermissionNeeded`; if a callback returns true the launch is cancelled |
| `getInstalledApplications(flags, userId)`, `getInstalledPackages(flags, userId)` | Virtual packages in a space |
| `clearPackage(pkg, userId)`, `stopPackage(pkg, userId)` | Clear data, force stop |
| `getUsers()` | `List<BUserInfo>` with public fields `id`, `status`, `name`, `createTime`. `name` has no setter, so we keep space names ourselves |
| `createUser(userId)`, `deleteUser(userId)` | `deleteUser` removes every package and the user's data directories |
| `isSupportGms()`, `isInstallGms(userId)`, `installGms(userId)`, `uninstallGms(userId)` | Virtual Google Play services. Upstream reports it is fragile (issues #57, #63, #64, #67) |
| `hasAllFilesAccess()`, `requestAllFilesAccess(Activity)`, `handleAllFilesAccessResult(int)` | Android 11+ storage access. Also `hasStoragePermission`, `requestStoragePermission`, `handleStoragePermissionResult` |
| `addAppLifecycleCallback(cb)`, `removeAppLifecycleCallback(cb)`, `getAppLifecycleCallbacks()` | **Per process.** Register in every process |
| `sendLogs(...)` | No-op after patch 0001 |
| `doCreateAsync`, `isCoreReady()` | Ours |

Static helpers valid **inside a clone process**: `getAppPackageName()`, `getAppProcessName()`, `getUserId()`, `getAppPid()`, `getBUid()`, `getApplication()`, `getAppConfig()`.

`NativeCore` (package `core`): `addIORule(target, relocate)` (substring replace on every path the hooked libc functions see), `enableIO()`, and `configureSpoof(String[] props, String[] mapsFilters)` (ours, patch 0008). Only `VirtualEngine.kt` calls these.

## AppLifecycleCallback

All methods are empty by default. Those that run in the clone process:

| Method | When |
|---|---|
| `beforeCreateApplication(pkg, processName, Context, userId)` | Before the target's `Application` object exists. **Spoofing starts here** |
| `beforeApplicationOnCreate(pkg, processName, Application, userId)` | Application exists, its `onCreate` has not run. Resources are available, so screen metrics and locale go here |
| `afterApplicationOnCreate(...)` | After the target's `onCreate` |
| `beforeMainLaunchApk(pkg, userId)` | UI process, inside `launchApk` |
| `onStoragePermissionNeeded(pkg, userId)` | UI process; return true to take over and cancel the launch |
| Activity lifecycle callbacks | It implements `Application.ActivityLifecycleCallbacks` |

## Patches and what they add

- `fake/spoof/IdentityStore` (patch 0007): per-process map the host fills in `beforeCreateApplication`. Keys read by hooks: `android_id`, `imei`, `meid`, `imsi`, `wifi_mac`, `wifi_bssid`, `wifi_ssid`. Empty means nothing is spoofed.
- `SystemProviderStub` rewrites `Settings.Secure ANDROID_ID` (it arrives as `call("GET_secure", "android_id")`).
- `ITelephonyManagerProxy` serves `imei`, `meid`, `imsi`. `IWifiManagerProxy` serves the wifi keys.
- `NativeCore.configureSpoof`: `__system_property_get` and `__system_property_read_callback` hooks with a per-process table, plus a `/proc/*/maps` filter that serves a filtered memfd.

## Things to know

- **Hooks that exist but are not effective.** `AntiDetection.cpp` has no installed hooks in the pinned commit. `AndroidIdProxy` and `DeviceIdProxy` are registered but do not spoof.
- **`WebViewProxy.getWho()` returns null** (upstream #35), so its hooks may never register. Unverified.
- **Stub components are exported.** Treat intents they receive as untrusted.
- **Clone data location.** `BEnvironment.getUserDir(userId)` inside the host's data dir. The path contains the host package, which container-detectors read. See `docs/research.md` section 6.
- The engine swallows several crash categories in `SimpleCrashFix` and returns from the uncaught-exception handler. The thread then dies without the process crashing, which can leave a clone half alive. This affects how we count crashes for the health indicator.
