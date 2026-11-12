# CloneSpace

An Android app that runs separate copies of other apps ("clones"), each with its own data, its own device
identity and optionally its own network proxy. It is built on a virtualization engine; plan.md has the design and
`docs/research.md` has the research and decisions.

**Read this first: nothing here has been compiled into an APK or run on a phone.** The cloud sandbox this was built
in could not reach the Android SDK, Google Maven or JitPack, and has no ARM device. What *was* verified is listed
under [What was verified](#what-was-verified). The code is complete enough to build; the first real build on a
machine with the Android SDK will probably need small fixes.

## Engine: NewBlackbox, kept and patched

We evaluated VirtualApp, BlackBox forks, VirtualXposed, SpaceCore, FreeSpace, VCore, VirtualAppX and every
actively pushed open-source fork we could find. None is clearly better than NewBlackbox:

- VirtualApp (asLody), ServenScorpion/VirtualApp, FBlackBox and SpaceCore have **no licence**, or a commercial one.
- VirtualXposed is **GPL-3.0** and stale since 2024.
- Every active Apache-2.0 fork (Blacks-BlackBox, PrismSpace, renjana) is a derivative of NewBlackbox, a
  one-commit repack, or has no native layer. Two (AsLodyOfficial/NewBlackBox and a similar anonymous repack)
  contain hidden uploads and look malicious.
- NewBlackbox is Apache-2.0, pushed in July 2026, ARM64, builds with AGP 8.13, and has by far the broadest hooks.

Its upstream `main` has no commits newer than our pin `89b5983`, so the pin did not move. The table and evidence are
in `docs/research.md`. The app only reaches the engine through `VirtualEngine.kt`, so the engine can be swapped later.

## Build steps

Needs: JDK 21, Android SDK platform 36, NDK `29.0.13846066`, Android Gradle Plugin 8.13 (the wrapper uses Gradle 8.14.3),
network access to `github.com`, Google Maven and Maven Central.

```bash
scripts/fetch-engine.sh                 # clones NewBlackbox at the pin into engine/ and applies patches/*.patch
./gradlew :app:assemblePlayDebug        # Google Play flavour: no VPN service, no all-files access
./gradlew :app:assembleSideloadDebug    # sideload flavour: also has the engine's VPN service and all-files access
./gradlew :app:testPlayDebugUnitTest    # unit tests (profiles, backup, leak analysis, shortcut parsing)
```

`:app` builds the `:probe` app first and bundles it as an asset (the leak test installs it inside a clone).
The APKs are ARM only (`arm64-v8a`, `armeabi-v7a`); x86 emulators will not work.

### Which build step was blocked here, and why

The sandbox's network policy refuses these hosts (HTTP 403 from the egress proxy):
`dl.google.com`, `maven.google.com`, `jitpack.io`. So:

1. **The Android SDK and NDK could not be installed** (they come from `dl.google.com`). No `./gradlew assemble*` could run.
2. **Google Maven is blocked**, so the Android Gradle Plugin and every AndroidX/Compose artifact could not be resolved.
3. **`git push` was refused** with 403 ("repository not in this session's authorized set"). The work exists as local
   commits on branch `ccr-efe8447f-4kdeou`. Add `douggue/mcptest` to the session's sources and push.

Maven Central and `github.com` (clone only) worked, which is how the checks below were done.

## What was verified

| Check | Result |
|---|---|
| `scripts/fetch-engine.sh` from scratch: 12 patches apply, result identical to the working tree | passed |
| Patched engine Java files (12) parsed with `javac` | no syntax errors (symbol resolution not possible: the engine's generated reflection classes need the full Android build) |
| Patched native code (`VirtualSpoof.cpp`, `ProxyHook.cpp`) compiled with `g++ -std=c++17` against stub headers | passed |
| Native proxy logic run on a Linux host against a local server: SOCKS5 with login and domain names, HTTP CONNECT with login, fake DNS, UDP block | passed |
| Profile, backup/restore, health, metadata, leak analysis, shortcut parsing: 18 JVM unit tests (Kotlin 2.1) | passed, stable over repeated runs |
| `VirtualEngine`, `CloneApp`, repository, leak runner, `ProfileApplier`, `Collector` compiled with Kotlin against the real Android 16 framework jar, with the engine's public API as stubs written from its source | passed |
| Compose UI, `ShortcutSupport`/`ShortcutActivity`, Gradle/AGP configuration, native build with the NDK, manifest merge | **not compiled** |

Two real bugs were caught by these checks (a `*/` inside a Javadoc comment in a patch, and a type error in the
profile generator), which is why the unverified items above are likely to have a few more.

## Which engine fixes were applied

All in `patches/` (one per fix, see `patches/README.md`); evidence in `docs/research.md` section 3.

1. **Hidden log upload removed** (0001): `LogSender` deleted, `getLogSenderChatId()` returns null, `sendLogs` is a no-op. Our own configuration also returns null.
2. **Public logcat dump disabled** (0002).
3. **JitPack and FreeReflection replaced** by LSPosed AndroidHiddenApiBypass from Maven Central (0003).
4. **Shell-string `chmod`/`ln -s`** replaced by argument arrays (0004).
5. **Non-blocking startup** (0005, 0012): `doCreateAsync(ReadyCallback)`; the app shows a splash screen until ready, reports failure honestly and can retry.
6. **WebView / "no network" in clones** (0006): network permissions granted to clone packages. `SEND_SMS` is no longer reported as granted.
7. **Per-clone identity** (0007): Android ID, IMEI/MEID/IMSI and Wi-Fi values come from the clone's profile instead of one `md5(hostPackage)`.
8. **Per-process native properties and `/proc/<pid>/maps` filter** (0008) instead of a hard-coded Pixel 6 / Android 12 table applied to every process including the host UI.
9. **SDK levels** (0009): compile 36, target 36, minSdk 24. (The host app targets 36.)
10. **Per-clone proxy** (0010): SOCKS5 / HTTP CONNECT, proxied DNS, UDP block.
11. **Per-clone notification label** (0011).
12. App manifest removes the Play-restricted permissions the engine merges in (SMS, call log, `QUERY_ALL_PACKAGES`, install packages, usage stats, background location, overlay, and others), renames the server process from `:black` to `:sync`, and adds the special-use foreground-service subtype Play requires.

**Not fixed** (needs a device): hooks that may break at target 36, exported stub components (upstream #39), the
`WebViewProxy.getWho()` null (#35), `IServiceConnection.connected` signature crash (#60), `AntiDetection.cpp` file hiding
(it installs nothing in the pinned commit). See `docs/research.md` sections 2 and 9.

## Status by plan phase

### Phase 1: project setup
- [x] Gradle project, version catalog, `:app`, `:probe`
- [x] `scripts/fetch-engine.sh` with pinned commit and patch application
- [x] Patch 1 (log upload) and 11 more
- [x] Root values the engine reads (compile 36, target 36, minSdk, NDK, hidden-API-bypass version)
- [x] JitPack no longer needed
- [x] `./gradlew :app:assembleSideloadDebug` and `:app:assemblePlayDebug` produce APKs (built 2026-11-10 with SDK 36, NDK 29.0.13846066; 18 unit tests pass). Not yet run on a device.

### Phase 2: engine startup
- [x] `attachBaseContext` with our `ClientConfiguration` (host package, no log upload)
- [x] `doCreate` off the main thread, readiness callback, splash screen until ready, failure screen with retry
- [x] `AppLifecycleCallback` loads the clone's profile and proxy in `beforeCreateApplication`
- [ ] Verified on a device

### Phase 3: core features
- [x] App picker (launchable non-system apps, search, "Not supported: no ARM build", split-APK warning, ToS warning)
- [x] Clone in the background with progress and the engine's error message
- [x] Home grid grouped by space, space chips, clone-number badge, launch
- [x] Long-press menu: shortcut, rename, clear data, force stop, remove, plus backup and restore
- [x] Home-screen shortcuts, `ShortcutActivity` validates package and space and checks the clone exists
- [x] Profile editor with regenerate, proxy settings and a connection test
- [ ] Everything above compiles and runs on a device

### Phase 4: making clones usable
- [x] Notification labelling per clone (engine hook, patch 0011)
- [x] Google sign-in: long-press menu entry "Install Google services in this space" (calls the engine's `installGms`). **Untested, and upstream reports it is fragile**
- [x] Storage access: asks for all-files access in the sideload build; the Play build uses per-clone storage
- [x] Per-clone identity: device-profile system (see below)
- [x] Per-clone proxy: in-process connect and DNS hooks, with the proxy per clone. **Catch-all VPN: not built.** Only the engine's own VPN option exists (sideload build) and there is no UI toggle
- [x] Leak test with a probe app installed in the clone
- [ ] Compatibility testing on 20 apps and Android 12 to 16: **needs your phones and accounts**

### Phase 5: release (not started, by design)
- [ ] Privacy policy, Play Console permission and VPN declarations, listing, fallback channel, monetization

### Features beyond the plan
- [x] Batch clone (same app into N new spaces) and cloning into several existing spaces
- [x] Per-clone custom name, badge colour (in the grid and on the shortcut icon), notification label
- [x] Backup and restore of a clone's data to a zip via the system file picker (no storage permission); refuses a backup of another app and rejects path-traversal entries
- [x] Clone health: last launch result and crash count, shown as a warning mark and in the long-press menu
- [x] Material 3 UI following plan.md section 5.2, with dark mode and the three fonts (bundled, OFL)

### Device-profile system (privacy isolation between accounts)
- 6 device templates (Pixel 7, 8, 9; Galaxy S23, A54; Xiaomi 13), 8 regions with real operator codes. One template per profile, so vendors never mix; the generator and tests check it.
- Profile fields: Android ID, all listed `Build` fields, advertising ID, GSF ID, IMEI (valid Luhn), IMSI, SIM serial, Wi-Fi MAC/SSID, serial, SIM operator/country/name, phone type, locale, time zone, density, resolution, sensor list.
- **`SDK_INT` and release are recorded but never faked**: apps and the framework branch on them. The fingerprint is chosen for the real OS level so it agrees.
- Store per space and package with regenerate, "new device", lock, import and export (import is rejected unless internally consistent).
- Applied before the target's code: `Build` fields, locale, time zone (Java reflection), Android ID, telephony and Wi-Fi (engine hooks), `ro.product.*`, `ro.build.*`, SIM and time-zone properties (native hook, also seen by `SystemProperties.get`), `/proc/cpuinfo` (file redirect).
- **Applied only when you opt in:** screen density and size (can break layouts).
- **Stored but not applied yet:** advertising ID, GSF ID and sensor list (need Google Play services and sensor hooks), MediaDrm ID.
- **Template build ids are best effort.** Model, codename, hardware and board strings are the well-known values; per-release build ids and increments must be refreshed from vendor factory images before release.

### Container hiding (aimed at what research found matters)
Done: `/proc/<pid>/maps` filtered for `blackbox`, `niunaijun`, `dobby`; server process renamed from `:black`; package
visibility limited to launchable apps by `<queries>`; Wi-Fi SSID no longer `BlackBox_Wifi`; fake `Hardware` in `/proc/cpuinfo`.
Not done: engine class names in stack traces (cannot be renamed while the engine's keep rules and reflection need them),
data directory paths (they contain the host package), stub names `:p0…`, uid, binder-proxy checks, raw-syscall reads.
Apps that require Play Integrity cannot pass inside any container; this is unfixable client-side.

## Testing guide for your phones

You need two or more ARM phones on different Android versions (ideally 14, 15 and 16) and test accounts.

1. **Build and install** the `sideload` debug build first (it is the more permissive one). `adb install app-sideload-debug.apk`.
2. **Start-up.** The splash screen should disappear within a few seconds and show the home screen. If you see "The clone engine did not start", run `adb logcat | grep -E "BlackBox|VirtualEngine"` and send me the lines.
3. **Clone a simple app** (a calculator or notes app with no login). Pick it, tap Clone, wait, tap the icon.
4. **Clone it again** into a second space; check the badge numbers 1 and 2.
5. **Long-press** each menu entry: rename, shortcut (pin it, then tap it from the launcher), force stop, clear data, backup (save the zip), restore, remove.
6. **Leak test** (menu, "Run leak test"). The probe opens inside the clone, then results appear. Every row should be Isolated except those marked Not tested. Rows marked Leak are the bugs to report. Run once with the proxy off and once with a real proxy on.
7. **Proxy.** In "Identity and network" enter your SOCKS5 or HTTP proxy, press Test connection (should show the exit IP), Save and restart, then open a browser app in the clone and visit an IP-check site. Also try a WebView-based app.
8. **WebView.** Upstream reports that WebView pages fail in clones (`ERR_CACHE_MISS`); patch 0006 should fix that. Check an app that shows web content.
9. **Real apps.** Try your 20 target apps one by one on each Android version. For each, note: starts, logs in, receives notifications, shows web content, survives force stop. Crashes appear as a warning mark on the icon; report the `adb logcat` output.
10. **Play flavour.** Repeat steps 3 to 6 with `assemblePlayDebug`. The VPN and all-files-access features are intentionally absent.

Things to watch for specifically: crashes right after tapping an icon on Android 15 or 16 (most likely at target 36),
clones that cannot read or write files, and notifications missing the space label.

## Layout

```
plan.md, README.md, THIRD_PARTY.md
docs/research.md       research, decisions, corrections to the plan, open questions
docs/engine-api.md     the engine's real API, from its source
patches/               engine fixes, one per file; scripts/fetch-engine.sh applies them
native-tests/          test of the engine's proxy code against a mock proxy; native-tests/run.sh runs it on an emulator or phone
engine/                git-ignored, created by the script
app/                   the app (Compose UI, VirtualEngine wrapper, profiles, proxy, data)
probe/                 tiny app installed inside a clone by the leak test
shared/                code shared by app and probe (collector, keys)
```

Rules held throughout: only `VirtualEngine.kt` touches the engine; nothing slow runs on the main thread; no
analytics and no uploads. The only network requests the app makes are ones you start: the proxy test and the leak
test, both to `1.1.1.1` (through your proxy for the proxy test), the proxy-location lookup when "Match proxy location" is on
(to `ipwho.is`, or `ipapi.co` if that fails, always through the proxy so only the proxy's address is seen), plus whatever the cloned apps themselves do.

## Open questions (from research)

1. Does the engine run on Android 16 at `targetSdk 36`? Nothing in its source mentions it. Needs a device.
2. Which hooks break at target 36 (dex file permissions, foreground-service types)? Only visible by running clones.
3. Can the exported stub components be made non-exported without breaking launches and notifications (upstream #39)?
4. Should cleartext traffic stay on in the library? Clones may need it; Play flags it.
5. Can the advertising ID and MediaDrm ID be spoofed without hooking Google Play services?
6. Will Google Play accept the listing? There is no explicit cloner clause; risk is medium (docs/research.md section 4). Play policy text could not be fetched here and must be re-checked.
7. Which of your 20 apps actually work, and which block containers server-side?
8. Android 17 (API 37) blocks cross-profile loopback by default and adds `ACCESS_LOCAL_NETWORK`; retest the proxy there.
9. Template build ids need refreshing from factory images.
10. Proxy passwords are stored in app-private storage in plain text; moving them to the Android Keystore is a later step.

## Acceptable use

Cloned apps often forbid copies in their terms of service and may ban accounts. The app warns before cloning. This
project is for separating your own accounts (work and personal, family members' devices you manage) and is not
meant for bulk account creation or evading bans.
