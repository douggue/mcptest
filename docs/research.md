# Research findings and decisions

Date of research: 2026-11-10. Evidence tags: **[V]** verified from a primary source or from the engine source in this session, **[S]** from search snippets or secondary sources, **[U]** unverified or analysis. The sandbox could not reach support.google.com, dl.google.com, maven.google.com, jitpack.io or the Android SDK, so Play Console policy text is [S]/[U] and must be re-checked on a networked machine.

## 1. Engine choice

### 1.1 Comparison

Criteria: commercial-use licence (Apache, MIT, BSD only), Android 14/15/16, activity in the last 12 months, ARM64, builds with AGP 8.x, hook quality, hidden network calls. Licences were read from the repository's LICENSE file where one exists. Candidates were shallow-cloned and grepped, never executed.

| Candidate | Licence | Android 14/15/16 | Last commit | ARM64 | AGP 8.x | Hooks (identity, network) | Hidden network | Verdict |
|---|---|---|---|---|---|---|---|---|
| **ALEX5402/NewBlackbox** (89b5983) | Apache-2.0 [V] | 14 and "15+" claimed; 16 not evidenced | 2026-07-19 | yes | AGP 8.13.2 [V], build not run here | About 70 Java service proxies plus native Dobby hooks. Strongest found | **Yes**: `LogSender` uploads logs to `logs-sender-api.vercel.app` [V] | **KEEP, patched** |
| Black00Z/Blacks-BlackBox | Apache-2.0 | claims 16 hardening, unverified | 2026-05-12, hobby fork | yes | likely | NewBlackbox plus extras | same `LogSender` | Ideas only |
| mhmdwaelanwr/PrismSpace | Apache-2.0 | unverified | 2026-09-16, one commit | yes | likely | NewBlackbox derivative | none found | Watch; too young |
| nullimwtx654-max/BlackBox | Apache-2.0 label | unverified | 2026-11, one commit | yes | likely | anonymous repack of the baseline | keeps `LogSender`, downloads APKs | Reject |
| AsLodyOfficial/NewBlackBox | Apache-2.0 label | unverified | 2026-10-26, one commit | yes | ? | repack | Telegram bot token upload, third-party connect call | **Reject (looks malicious)** |
| josskixg/renjana | Apache-2.0 | partial | 2026-08-26 | n/a | yes | Java only, no native layer | Google OAuth calls | Reject (immature) |
| asLody/VirtualApp | **no licence**; code frozen 2017, commercial licence | no | stale | n/a | n/a | n/a | n/a | Reject |
| ServenScorpion/VirtualApp | **no licence**, "for learning only" | claims 14 | 2026-10 | yes | ? | closed blobs | not audited | Reject |
| FBlackBox/BlackBox | no LICENSE file, dissolved 2024 | no | 2024-04 | - | - | - | - | Reject |
| android-hacker/VirtualXposed | **GPL-3.0** | no | 2024-03 | - | - | - | - | Reject |
| FSpaceCore/SpaceCore | no licence | no | 2024-02 | - | - | - | - | Reject |
| VirtualAppX, FreeSpace, VCore | no maintained repository found | - | - | - | - | - | - | Reject (not found) |

### 1.2 Decision: keep NewBlackbox at the existing pin

No candidate is clearly better. Every permissively licensed and active fork derives from NewBlackbox, so none has an independent or stronger hook base. The mature lineages are commercial (VirtualApp) or GPL (VirtualXposed). The wrapper design in plan.md section 4 is unchanged; only `VirtualEngine.kt` knows which engine is underneath.

Forks worth re-reading later, under Apache-2.0 with notices kept: PrismSpace (a telemetry-free tree) and Blacks-BlackBox (claimed Android 16 hooks). Neither is trusted yet.

## 2. NewBlackbox: upstream state and the pin

- `main` is still at the pin `89b5983`. There are no newer commits and no other branches except tag `2.0-r1beta` [V].
- **Decision: do not move the pin.** There is nothing newer. The fixes worth taking exist only as open, unreviewed pull requests, opened on 2026-11-09 by one contributor. They count as untrusted code, so we reimplemented the small ones as our own patches instead of merging them.
- The GitHub API was denied, so issue data comes from web pages: 44 issues, 26 open. No issue or PR mentions Android 16.

| Upstream item | Meaning | What we did |
|---|---|---|
| #68, #46, #27, #32, #34, #6: WebView `ERR_CACHE_MISS`, "no network" | Chromium asks the package manager for the clone package's INTERNET permission and is denied | **Patch 0006** grants the six network permissions |
| #40: hard-coded log chat id | Hidden uploader | **Patch 0001** |
| #42: `chmod` and `ln -s` built as shell strings | Command injection | **Patch 0004** |
| #41: cleartext allowed, `allowBackup` | Demo app and library defaults | Our manifest sets `allowBackup=false`. Cleartext is left on in the library because clones need it; see open questions |
| #39: exported proxy components | Stub activities, services and providers are `exported="true"` | **Not fixed.** Needs on-device testing. Listed as open question 4 |
| #35: `WebViewProxy.getWho()` returns null | WebView hooks may never register | **Not fixed.** Needs on-device verification |
| #60: `AbstractMethodError` in `IServiceConnection.connected` (4-argument form on newer Android) | Crash on new Android versions | **Not fixed.** Needs a device to reproduce |
| #37 / PR #62: `setApplicationLocales` `SecurityException` | Play Store inside a clone | Not taken. Google Play services inside the container is fragile and low value |
| PR #66: Android 15/17, microG, FCM | Auto-connects to `mtalk.google.com:5228` and auto-registers GCM | **Rejected** (adds outbound traffic). Its small compat items are candidates for later |
| PRs #72, #78, #79, #80, #84 | Small crash and hygiene fixes | Read first when we can test on a device |

## 3. Problems found in the engine source (beyond plan.md)

All of these were confirmed by reading the pinned source [V].

1. **Hidden upload.** `utils/LogSender.java:14` POSTs logcat plus device info to a Vercel relay. The default chat id `-1003719573856` is hard-coded in `ClientConfiguration.getLogSenderChatId()`. `SimpleCrashFix` fired it automatically on every caught crash. Fixed by patch 0001.
2. **Public logcat dump.** `BlackBoxCore.startLogcat()` wrote the entire device logcat to `Downloads/logs` (shared storage) on every UI-process start. That can contain other apps' data. Fixed by patch 0002.
3. **Hard-coded global spoof.** `cpp/Utils/VirtualSpoof.cpp` forced one "Pixel 6, Android 12" property table in **every** process, including the host UI, via a library constructor. It also never matched the real Android version. Replaced by patch 0008 with a per-process, initially empty table.
4. **Container-hiding is not installed.** `cpp/Utils/AntiDetection.cpp` declares block lists and wrapper functions, but `install_file_hooks()` installs nothing. Native path hiding did nothing in the pinned commit [V]. Patch 0008 adds a real `/proc/*/maps` filter. Other hiding is still pending.
5. **Weak identifier spoofing.** `AndroidIdProxy` never replaced a valid value. `ITelephonyManagerProxy` returned `md5(hostPackage)` for IMEI, IMSI and device ID, the same value for every clone and not a valid IMEI. `IWifiManagerProxy` returned the fixed SSID `BlackBox_Wifi` and a fixed BSSID, which is a detection tell. Patch 0007 reads per-clone values from `IdentityStore`.
6. **Over-broad permissions.** The library manifest merges 323 `uses-permission` lines into the host, including SMS, call log, `QUERY_ALL_PACKAGES`, `MANAGE_EXTERNAL_STORAGE`, `REQUEST_INSTALL_PACKAGES`, `PACKAGE_USAGE_STATS` and vendor-specific ones. Play restricts several of them. The app manifest removes the restricted set with `tools:node="remove"`.
7. **False permission grants.** `IActivityManagerProxy.checkPermission` reported `SEND_SMS` as granted for every clone. Removed in patch 0006.
8. **Mislabeled helper.** `FileUtils.createSymlink` called `Os.link` (hard link) first. It has no callers, so it was left alone apart from the shell fix.
9. **Blocking startup.** `doCreate()` polls up to about 2.5 seconds in `ensureBlackProcessInitialized()` plus binder calls, on the calling thread. Patch 0005 adds `doCreateAsync`.
10. **Foreground services.** `ProxyService.showNotification()` calls `startForeground` without a type but is never called [V]. `DaemonService` and `ProxyVpnService` declare `specialUse`. Targeting API 36 needs the Play special-use declaration for these.
11. **Dependency.** FreeReflection came from JitPack (blocked here, and a supply-chain hop). Replaced with LSPosed AndroidHiddenApiBypass from Maven Central (patch 0003).
12. **Other outbound traffic.** The only `HttpURLConnection` use in `Bcore/` and `app/` was `LogSender`. The demo app opens two browser links (GitHub, Telegram) and uses osmdroid map tiles. Native code was not grepped for sockets. [U]

## 4. Google Play (target level and policy)

- **[V] Target API.** From 2026-08-31 new apps and updates must target Android 16 (API 36); Wear OS and Automotive need 35, TV and XR 34. The extension to 2026-11-01 has closed. We use `compileSdk = 36`, `targetSdk = 36`. The next bump (API 37) is probably around August 2027 [U]. Android 17 is API 37 and reportedly stable since June 2026 [S].
- **[S] VpnService** needs a declaration form and VPN must be the app's core function. A cloner's per-clone proxy is not core VPN, so the VPN service is excluded from the `play` build flavor.
- **[V/S] QUERY_ALL_PACKAGES** is for accessibility, browser, device-management and security apps. A cloner is not listed, so we use `<queries>` with a MAIN/LAUNCHER intent instead.
- **[S] MANAGE_EXTERNAL_STORAGE** is for core file-management uses; media access is excluded. Only the `sideload` flavor requests it.
- **[U] REQUEST_INSTALL_PACKAGES** is for core install functionality only. Removed from the host.
- **[U] Cloner policy.** There is no explicit clause. Relevant policies: Device and Network Abuse, Deceptive Behavior, dynamic code. Listing is feasible with medium risk.
- **Listing language.** Use "second instance of an app you own, separate data, work and personal separation, privacy isolation". Avoid "bypass", "spoof", "hide from app", "ban evasion", and brand affiliation.

## 5. What identifiers apps can still read (Android 14, 15, 16)

| Identifier | Status | Our handling |
|---|---|---|
| IMEI, serial, ICCID | [V] blocked for normal apps since Android 10/11 | Per-clone fake or "unknown", kept consistent |
| MAC address | [V] not readable; placeholder value | Placeholder, never the engine's old fixed value |
| Android ID | [V] one value per app signing key. Inside a container every clone shares the host's key, so all clones see the **same** value unless virtualized | **Main target.** Per-clone value via the settings provider hook (patch 0007) |
| Advertising ID | [V] user-resettable; zeros when opted out | Stored in the profile; applying it needs Google Play services hooks. **Pending** |
| App Set ID, Firebase installation ID | [V] app- or developer-scoped | Isolated by per-clone data dirs |
| MediaDrm unique ID | [U] readable without permission | **Not spoofed yet** |
| GSF ID | [U] effectively unavailable | Stored only |
| SIM operator, country, phone type | [U] readable without permission, via system properties | Native property table (patch 0008) |
| `Build.*`, `ro.*` properties, `/proc`, `/sys` | [U] mostly readable | Java reflection plus native property hook plus `/proc` redirects |

## 6. How containers are detected, ranked by practical impact [U unless marked]

conbeerlib [V] checks permission mismatch, `/proc/self/maps` entries, storage-directory paths, environment variables, foreign running services and dynamically enabled components.

1. Data and file paths, including `/proc/self/cmdline` and mountinfo.
2. Package name, signature and UID mismatches, and the host package showing up in `getPackagesForUid` or installed-package lists.
3. Stack traces, class names and `/proc/self/maps` (`top.niunaijun.blackbox`, `libblackbox`).
4. Process and UID patterns (`:p0`, `:black`, one shared UID).
5. Stub component names.
6. Binder and ServiceManager proxy class checks.
7. Raw-syscall native checks that bypass libc hooks (commercial RASP SDKs).
8. Environment variables.
9. **Play Integrity [V].** The token reflects the real caller, which is the cloner. A guest app that enforces Play Integrity cannot pass in any container. We do not spend effort here, and the README says so.

Most apps check only 1 to 3. Hardened banking and anti-cheat apps add the rest, plus server-side correlation. Our hiding work covers items 3 (maps filter, class names), 4 and 5 (neutral process labels, pending in the manifest), and the package-visibility part of item 2 (`<queries>`, and the picker hiding the host and other clones). Items 1, 6 and 7 are not solved and are listed as pending.

## 7. Techniques considered for borrowing (licence checked)

| Source | Licence [V] | Use |
|---|---|---|
| LSPosed/AndroidHiddenApiBypass | Apache-2.0 | **Used** (patch 0003) |
| tiann/FreeReflection | MIT | Replaced |
| hexhacking/xDL | MIT | Already vendored in the engine |
| jmpews/Dobby | Apache-2.0 | Already vendored; update later for arm64 PAC/BTI |
| bytedance/android-inline-hook (ShadowHook) | MIT | Candidate replacement for Dobby, not adopted |
| bytedance/bhook (bytehook) | MIT | Candidate for PLT-level IO redirects, not adopted |

Rejected on licence: LSPlt (LGPL-3.0), LSPlant (LGPL), canyie/pine (Anti-996), asLody/VirtualApp and GPL forks. No permissive reference exists for hiding `/proc/self/maps`; ours is original code (patch 0008) that opens the real file and serves a filtered `memfd`.

## 8. Corrections to plan.md

- Section 3 table: Android support is "14 and 15 claimed; 16 unverified", not "5.0 to 15". `compileSdk` is 36 and `targetSdk` is 36, not 35. The engine's own root file used 28.
- Section 3.1 item 1: the hidden uploader had three triggers (automatic on crash, manual in the demo app, public logcat dump), not one.
- Section 1.2: Android ID is scoped per signing key, so clones in one container share it unless we spoof it. IMEI spoofing is largely irrelevant because normal apps cannot read it.
- Phase 1 step 5: JitPack is no longer needed (patch 0003).
- Phase 4 item 3 and Phase 5: avoid `MANAGE_EXTERNAL_STORAGE`, `QUERY_ALL_PACKAGES` and `VpnService` in the Play flavor.
- Section 1.3 and Phase 4 item 5: Android 17 blocks cross-profile loopback by default and adds `ACCESS_LOCAL_NETWORK` [V], which matters for a local proxy design.

## 9. Open questions

1. Does the engine run on Android 16 (API 36) with `targetSdk 36`? Nothing in the engine mentions it. Needs a real device.
2. W^X and dex rules at target 34+: does the engine load clone dex files read-only? `CopyExecutor` calls `setReadOnly` [V], but other copies may not.
3. What does the engine break when `targetSdk` goes from 28 to 36? The host app's own manifest and foreground-service types are handled. Hook-level breakage can only be found by running clones.
4. Exported stub components (upstream #39): can they be set to `exported="false"` without breaking launches and notifications?
5. Should cleartext traffic stay enabled in the library? Clones may need it; Play flags it.
6. Can the clone's Advertising ID and MediaDrm ID be spoofed without hooking Google Play services?
7. Which of the 20 target apps actually work? Test accounts are needed.
8. Does Play accept the listing? Unknown until review.
9. Network policy blocked dl.google.com, maven.google.com and jitpack.io in the build sandbox, so no build was run here. See README.

## 10. Sources

- https://developer.android.com/google/play/requirements/target-sdk [V]
- https://developer.android.com/about/versions/17/release-notes [V]
- https://developer.android.com/training/articles/user-data-ids [V]
- https://developer.android.com/training/package-visibility/declaring [V]
- https://developer.android.com/google/play/integrity/verdicts [V]
- https://github.com/darvincisec/conbeerlib [V]
- https://github.com/ALEX5402/NewBlackbox and its issues and pull requests (web pages)
- Play Console help answers 11926878, 12564964, 10158779, 10467955 [S, not fetched]
