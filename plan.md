# Plan: Building a Multi-Account App Cloner for Android

This plan explains how to build an app like "Multi Accounts / Clone Apps" from Google Play.
That kind of app runs a second, third or nth copy of another app, such as WhatsApp, with a separate login.
It covers how cloners work, the engine to build on, the architecture, the build phases, and the risks.

---

## 1. What an app cloner actually is

On Android, a cloner runs the target app inside a **container process**.
The container is a virtual app framework such as VirtualApp or one of its descendants, like BlackBox or NewBlackbox.
The target app is never really installed on the phone.
The cloner loads the target's APK into its own process and makes the app believe it is running normally.

Each clone gets:

- **Its own data directory.** Files, databases, shared preferences and caches are redirected into a private folder per clone. That is what makes a second login possible.
- **Its own view of the system.** The cloner intercepts the app's requests to Android and returns its own answers.

### 1.1 How the interception works

| Layer | Technique | What it is used for |
|---|---|---|
| Java framework | Replace the Binder proxies for system services such as ActivityManager, PackageManager, AccountManager, NotificationManager and TelephonyManager | Fake package info, start components, route notifications, fake identifiers |
| Manifest stubs | The cloner declares a pool of placeholder activities, services and content providers. At runtime it starts a stub and swaps in the real class. | Lets a non-installed app start activities and services |
| Native code | Hooks on C library functions such as `open`, `stat`, `access`, `connect` and `getaddrinfo`, using an inline hook library such as Dobby | File path redirection, per-clone networking, hiding the cloner |
| Hidden APIs | Bypass Android's restrictions on non-public APIs, using libraries such as FreeReflection or HiddenApiBypass | Needed for almost every framework hook |

### 1.2 Per-clone identity

A cloner can return a different value for each device identifier in each clone.
On current Android, fewer identifiers matter than people expect:

| Identifier | What a normal app sees today | What the cloner does |
|---|---|---|
| Android ID | One value per app signing key and per user since Android 8. All clones share the host's signing key, so without spoofing every clone sees the same value. | Fake a unique value per clone. This is the main identifier. |
| IMEI and serial number | Blocked for normal apps since Android 10 | Return a consistent fake or "unknown." Few apps can still read them. |
| Wi-Fi MAC address | A fixed placeholder (`02:00:00:00:00:00`) since Android 6 | Usually nothing to do |
| Installed apps list | Limited by package visibility rules since Android 11 | Hide the cloner and the other clones from each clone |
| Build model and fingerprint | Readable by any app | Optional fake per clone. It must stay consistent with the rest of the device profile. |
| Advertising ID | Comes from Google Play services | Give each clone its own ID inside the virtual copy of Google Play services |

A fake profile must be **internally consistent**.
For example, a Samsung model with a Pixel build fingerprint is easy for anti-fraud systems to spot.

### 1.3 Per-clone proxy

A per-clone proxy means each clone's network traffic leaves through its own tunnel or proxy.

Android's VPN service cannot do this alone.
Its per-app rules work by app UID, and every clone runs under the cloner's single UID.
A per-clone design therefore needs two parts:

1. **In-process hooks.** Hook `connect` and DNS lookups inside each clone process. Send that clone's connections to its own SOCKS5 or HTTP proxy.
2. **A catch-all VPN.** Optionally run one VPN service owned by the cloner. It handles traffic that bypasses the hooks, such as WebView's separate network process, and blocks leaks.

---

## 2. Three ways to build a cloner, and the choice

| Approach | How it works | Pros | Cons |
|---|---|---|---|
| **1. App virtualization (chosen)** | Container process plus hooks, as described above | Unlimited clones, per-clone identity and proxy, no system setup for the user | Very hard. Breaks with new Android versions. Apps can detect it. Play review risk. |
| 2. Android Work Profile | The app becomes the "profile owner" of a managed profile. Android installs real copies inside it. Used by Shelter and Island. | Official, stable, Play-friendly | Only one extra copy. No identity or proxy control. |
| 3. APK repackaging | Decompile, rename the package, re-sign and install. Used by App Cloner. | Simple concept | Breaks Google sign-in, Play Integrity and push notifications |

This plan uses **approach 1**.

---

## 3. The engine: NewBlackbox

Writing a virtualization engine from scratch takes person-years.
The plan builds on **NewBlackbox** (`github.com/ALEX5402/NewBlackbox`).

| Fact | Detail |
|---|---|
| License | Apache 2.0. Commercial use is allowed. Keep the license and notices. |
| Pinned commit | `89b59836c66f173756a4ae258cf379a957649820` (2026-07-19). Re-checked 2026-11-10: upstream `main` has no newer commit, so the pin stays. See `docs/research.md`. |
| Lineage | VirtualApp, then BlackBox (the original BlackBox repository is now empty), then NewBlackbox |
| Supported Android | Docs claim 14 and 15. Android 16 is not evidenced anywhere in the source and must be tested on a device. |
| CPU architectures | ARM64 and ARMv7 only |
| Build requirements | JDK 21, Android SDK 36, NDK 29.0.13846066, Gradle 8.14, Android Gradle Plugin 8.13 |
| Modules | `Bcore` (the engine), `black-reflection` and `compiler` (reflection helpers and annotation processor) |

### 3.1 Problems found in the engine

1. **Hidden log upload. Must fix.** The engine uploads the full device log plus device info to a third-party Telegram relay (`logs-sender-api.vercel.app`). The chat ID is hard-coded as the default in `ClientConfiguration.getLogSenderChatId()`. Device logs from cloned apps can contain private user data. It fired automatically on caught crashes, from a demo-app button, and the engine also dumped the whole device logcat into public `Downloads/logs`. Patches 0001 and 0002 remove all three, and our configuration also returns `null`.
2. **Old target API level.** The engine targets Android API 28. Google Play requires new apps and updates to target API 36 since 2026-08-31 (the extension ended 2026-11-01). The host app targets 36 and the engine is patched to match. Whether the hooks still work at 36 can only be learned on devices, and this remains the biggest technical risk.
3. **Blocking startup.** The engine's startup polls for its server process and can block the calling thread for seconds. Patch 0005 adds `doCreateAsync(ReadyCallback)`.
4. **Placebo and global spoofing.** The engine returned `md5(hostPackage)` as IMEI for every clone, never changed Android ID, forced a Pixel 6 / Android 12 property table in every process including the host, and its native hiding code installed no hooks. See `docs/research.md` section 3 and patches 0007 and 0008.
5. **323 merged permissions.** The library manifest adds SMS, call log, `QUERY_ALL_PACKAGES`, `MANAGE_EXTERNAL_STORAGE` and more to the host. The app manifest removes the restricted ones.
6. **Aspirational docs.** Its `Docs.md` describes methods that do not exist. Work from the source code instead. The real public API is in `BlackBoxCore.java`.

### 3.2 Engine API used by the app

| Need | Real method |
|---|---|
| Start the engine | `doAttachBaseContext(context, ClientConfiguration)` then `doCreateAsync(ReadyCallback)` (patched in; plain `doCreate()` blocks) |
| Clone an installed app | `installPackageAsUser(packageName, userId)` returns `InstallResult` with `success` and `msg` |
| Clone from an APK file | `installPackageAsUser(File, userId)` |
| Launch a clone | `launchApk(packageName, userId)` |
| List clones | `getUsers()` and `getInstalledApplications(flags, userId)` |
| Manage a clone | `clearPackage`, `stopPackage`, `uninstallPackageAsUser` |
| Spaces | `createUser(userId)`, `deleteUser(userId)` |
| Google Play services | `isSupportGms()`, `installGms(userId)`, `isInstallGms(userId)` |
| Labels and icons | `BlackBoxCore.getPackageManager()` with the clone's `ApplicationInfo` |
| Process checks | `isMainProcess()`, `isBlackProcess()`, `isServerProcess()` |
| Hooks into clone startup | `addAppLifecycleCallback(AppLifecycleCallback)` |

---

## 4. Architecture

```
┌──────────────────────────── Host app (one APK) ─────────────────────────────┐
│                                                                             │
│  Main process (UI)            Engine server process      Clone processes    │
│  ┌───────────────────┐        ┌──────────────────┐       ┌───────────────┐  │
│  │ Home grid         │ Binder │ Virtual package  │       │ Stub activity │  │
│  │ App picker        │◄──────►│ manager          │◄─────►│ + target app  │  │
│  │ Profile editor    │        │ Virtual activity │       │ code          │  │
│  │ Leak test         │        │ manager          │       │ Hooks: IDs,   │  │
│  └─────────┬─────────┘        │ Virtual users    │       │ files, net    │  │
│            │                  └──────────────────┘       └──────┬────────┘  │
│   VirtualEngine wrapper                                         │           │
│   (only place that calls BlackBoxCore)              per-clone SOCKS/HTTP    │
│                                                     proxy, VPN catch-all    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Repository layout

```
plan.md
README.md
settings.gradle.kts        includes :app and, if fetched, the engine modules
build.gradle.kts           root config, sets the values the engine reads (compileSdkVersion, minSdk...)
gradle/libs.versions.toml
scripts/fetch-engine.sh    clones NewBlackbox at the pinned commit into engine/ and applies patches
patches/                   our engine patches, one per fix
engine/                    git-ignored, created by the script
app/
  src/main/java/<your.package>/
    CloneApp.kt            Application class, starts the engine
    engine/VirtualEngine.kt   the only class that touches BlackBoxCore
    engine/CloneProfile.kt    fake identity and proxy settings per clone
    data/CloneRepository.kt   lists device apps and clones, runs installs off the main thread
    ui/MainActivity.kt        clone grid grouped by space
    ui/AppPickerActivity.kt   pick a device app to clone
    ui/ProfileActivity.kt     edit identity and proxy per clone
    ui/LeakTestActivity.kt    shows what a clone really sees
    ui/ShortcutActivity.kt    home-screen shortcut entry point
```

Fetching the engine with a script, instead of copying it into the repo, keeps the 5 MB of third-party code out of your history.
It also makes every change to the engine visible as a patch file.

### 4.2 Key design rules

- **One wrapper.** Only `VirtualEngine` calls engine classes. You can then upgrade or replace the engine without touching the UI.
- **Process awareness.** The engine starts several processes, and each one runs your Application class again. Build UI state only when `isMainProcess()` is true.
- **Nothing slow on the main thread.** Install, list and startup work runs in coroutines on a background dispatcher.
- **Spaces.** A space is a virtual user ID. The first WhatsApp clone goes in space 0, the second in space 1, and so on.

---

## 5. App design and style

A clickable mockup of the four core screens is on the design canvas:
https://claude.ai/artifact/9A6nCdhEnzwJo5Qmw4ihbe

The canvas is private until its owner shares it from its Share menu.

### 5.1 Screens

| Screen | What it does | Key elements |
|---|---|---|
| 1. Home | Shows every clone grouped by space | Space filter chips, 4-column icon grid per space, clone-number badge on each icon, "Clone an app" floating button |
| 2. Pick an app | Lists the phone's apps to clone | Search field, target space selector, "Clone", "Cloning…" and "Open" button states, "Not supported" for apps that block virtual apps, a terms-of-service warning |
| 3. Identity and proxy | Edits one clone's fake identity and network | Identity card with Regenerate, proxy on/off switch, SOCKS5 or HTTP choice, host, port and username fields, connection test with result, "Save and restart clone" |
| 4. Leak test | Shows what the clone really sees | Summary banner, one row per check comparing "Real phone" with "Clone sees", "Isolated" or "Leak" tag, button to turn on the VPN safety net |

Navigation: Home opens the picker from the floating button and the profile from a long-press on a clone. The profile opens the leak test.

### 5.2 Style guide

**Look.** Calm, light and utility-first. White cards on a pale gray ground, one blue accent, and orange reserved for clone numbers and warnings.

**Colors**

| Token | Hex | Used for |
|---|---|---|
| `background` | `#F7F7FA` | Screen background |
| `surface` | `#FFFFFF` | Cards, lists, inputs |
| `border` | `#E8E8EF` and `#E2E2EA` | Card outlines and input borders |
| `text` | `#16161D` | Main text |
| `text-muted` | `#5B5B6B` | Labels and secondary text. Passes 4.5:1 contrast on the background. |
| `accent` | `#3B5BDB` | Primary buttons, selected chips, switches, links |
| `accent-pressed` | `#2B44A8` | Pressed and hover states |
| `accent-soft` | `#EEF1FD` | Tip banners |
| `badge` and `warning` | `#C2410C` | Clone-number badges, leak warnings |
| `warning-soft` | `#FFF4EC` | Warning banners |
| `success` | `#15803D` | Passed checks, "Connected" status |

Status is never shown by color alone. Every pass or leak also has an icon and a word.

**Type**

| Role | Font | Size and weight |
|---|---|---|
| Screen title | Space Grotesk | 22 to 26 sp, bold |
| Section title | Space Grotesk | 16 to 17 sp, semibold |
| Body and buttons | Inter | 13 to 15 sp, regular to semibold |
| Labels | Inter | 11 to 12 sp, semibold |
| IDs, IPs, ports | JetBrains Mono | 12 to 13 sp, medium |

**Shape and spacing**
- Spacing uses a 4 dp grid. Screen side padding is 20 dp. Gaps inside cards are 12 to 16 dp.
- Corner radius is 20 dp for cards, 16 dp for app icons, 12 to 14 dp for inputs, and fully round for buttons and chips.
- Every touch target is at least 44 dp.
- Only the floating button has a shadow. Cards use a 1 dp border instead.

**Components**
- **App tile.** A 56 dp rounded icon with the clone-number badge at its bottom-right corner, and the app name below.
- **Space chips.** 36 dp pills. The selected chip is filled with the accent. "New space" has a dashed outline.
- **Buttons.** The primary button is filled with the accent and 52 dp tall. The secondary button is white with an outline. Small inline buttons are 36 to 40 dp.
- **Switch.** 52 by 32 dp. It uses the accent when on and gray when off.
- **Status row.** An icon in a colored circle, a name, a tag, and a "real versus clone" value pair.

**Building it on Android**
- Use Material 3 components, with the color tokens above as a custom color scheme.
- Support dark mode by mapping each token to a dark value. Use the same accent hue, made lighter so it keeps 4.5:1 contrast.
- Take app icons and names from the real apps through the package manager. The mockup uses letter tiles only as placeholders.
- Optional: let users pick the accent color. The mockup offers blue, teal, purple and black.

---

## 6. Build phases

### Phase 1: Project setup (about 3 days)
1. Create the Gradle project with the `app` module and the version catalog.
2. Write `scripts/fetch-engine.sh`. It clones NewBlackbox at the pinned commit and applies everything in `patches/`.
3. Write the first patch, which disables the log upload.
4. Set the root values the engine's build files read: `compileSdkVersion = 36`, `minSdk = 24`, `targetSdkVersion = 36`, `ndkVersion`, `hiddenApiBypass`.
5. JitPack is not needed: patch 0003 swaps FreeReflection for AndroidHiddenApiBypass from Maven Central.
6. Confirm `./gradlew assembleDebug` produces an APK.

### Phase 2: Engine startup (about 2 days)
1. In `CloneApp.attachBaseContext`, call the engine's attach method with your `ClientConfiguration`. Set the host package name, and return `null` from `getLogSenderChatId()`.
2. In `CloneApp.onCreate`, call `doCreate()`. Run the slow part off the main thread and show a splash screen until the engine reports its services are ready.
3. Register an `AppLifecycleCallback`. In `beforeCreateApplication`, load that clone's profile so fake identifiers and proxy settings apply before any app code runs.

### Phase 3: Core features (about 1 to 2 weeks)
1. **App picker.** List launchable device apps. Leave out system apps, your own app and apps whose native code has no ARM build.
2. **Clone.** Call `installPackageAsUser` in the background. Show progress and the `InstallResult` message on failure.
3. **Home grid.** Show clones grouped by space, with the clone number on each icon.
4. **Launch.** Tapping an icon calls `launchApk`.
5. **Long-press menu.** Create a home-screen shortcut, rename, clear data, force stop, or remove.
6. **Shortcuts.** `ShortcutActivity` is exported so launchers can open it. It must check that the package name and space ID belong to an existing clone before launching.
7. **Profile editor.** Show the generated identity with a regenerate button. Edit the proxy host, port, type and credentials, with a connection test.

### Phase 4: Making clones usable (about 2 to 3 weeks)
1. **Notifications.** Label each clone's notifications with the space name so users can tell accounts apart.
2. **Google sign-in.** Offer to install the virtual Google Play services into a space with `installGms`. Many apps need it to log in or receive push messages.
3. **Storage access.** Request full file access when the engine's callback asks for it. Clones fail on Android 11 and newer without it. `MANAGE_EXTERNAL_STORAGE` is a restricted Play permission, so only the sideload build requests it; the Play build uses per-clone app-specific storage.
4. **Per-clone identity.** Implement the identifier table from section 1.2 using the engine's existing spoofing code. Store profiles per space and package.
5. **Per-clone proxy.** Implement the two-part design from section 1.3. The Play build ships only the in-process part. `VpnService` is not core functionality for a cloner under Play policy and is in the sideload build only.
6. **Leak test.** A screen inside a clone shows the identifiers and public IP address it sees, compared with the real device. Test WebView, DNS and Google Play services traffic separately, because leaks usually happen there.
7. **Compatibility testing.** Test your 20 most important target apps on Android 12, 13, 14, 15 and 16. Fix each crash as a new file in `patches/`.

### Phase 5: Release (about 1 to 3 months, mostly uncertain)
1. **Target API level.** The target is already 36, the Play minimum since 2026-08-31. Retest everything on Android 14 to 16 and expect engine hooks to break. Budget the most time here. API 37 will probably be required around August 2027.
2. **Privacy policy.** Explain what the app reads, where the data stays, and that nothing is uploaded.
3. **Permissions.** Justify each one in the Play Console. The app avoids `QUERY_ALL_PACKAGES` (it uses a launcher `<queries>` intent), VPN and full file access in the Play build.
4. **Store listing.** Present identity and proxy features as privacy isolation between accounts.
5. **Fallback channel.** Keep a sideload or alternative-store release ready in case Play rejects the app.
6. **Monetization.** Add ads or a subscription only after the app is stable. Crashes plus ads drive users away fast.

---

## 7. Risks

| Risk | Impact | How to reduce it |
|---|---|---|
| Google Play rejection or removal | No main distribution channel | Privacy-focused listing, minimal permissions, fallback store |
| Engine breaks on new Android versions | Clones crash after OS updates | Pin the engine commit, test on beta Android releases, keep patches small |
| Target apps detect the container | Login blocked or accounts banned | Hide the cloner well, but tell users plainly that some apps forbid cloning |
| Terms of service of target apps | WhatsApp, Instagram and games can ban cloned accounts | Warn users in the app before cloning |
| Identity and proxy features look like fraud tooling | Stricter review, abuse by account farms | Rate limits, no bulk account creation, clear acceptable-use terms |
| Security of the container | Your app runs other apps' code with your permissions. A bug exposes every clone's data. | No network upload of logs, code review of patches, keep dependencies updated |
| Third-party engine quality | Hidden behavior like the log upload | Review the engine source before each upgrade |

---

## 8. Timeline summary

| Milestone | Effort for one Android developer |
|---|---|
| Working prototype: clone and launch apps | 2 to 3 weeks |
| Per-clone identity and proxy | 3 to 5 more weeks |
| Reliable on major apps and Android versions | 1 to 2 more months |
| Through Play review | Uncertain, 1 to 3 months |

---

## 9. Requirements to start

- A computer with Android Studio, JDK 21, Android SDK 36 and NDK 29.0.13846066
- At least two real ARM phones on different Android versions. Emulators on x86 are not supported by the engine.
- A Google Play developer account
- Test accounts for every app you plan to support

---

## 10. Revisions after research (2026-11-10)

Full evidence is in `docs/research.md`; the status of each phase is in `README.md`.

- **Engine.** NewBlackbox stays. No candidate was clearly better. The only permissive, active alternatives are its own forks.
- **Patches.** `patches/0001` to `0009` implement the engine fixes. `scripts/fetch-engine.sh` applies them.
- **Play flavors.** The build has a `play` flavor (no VPN service, no `MANAGE_EXTERNAL_STORAGE`) and a `sideload` flavor with both.
- **Android 17.** Cross-profile loopback is blocked by default and `ACCESS_LOCAL_NETWORK` is new. A localhost proxy design must be retested on API 37.
- **Play Integrity.** Guest apps that require it cannot pass inside any container, because the token reflects the real caller. The listing and in-app warning must say so.
