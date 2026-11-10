# Engine patches

Applied in filename order by `scripts/fetch-engine.sh` on top of NewBlackbox commit
`89b59836c66f173756a4ae258cf379a957649820`. One fix per file. Each is a plain `git diff`, so
`git apply` works on it. Details and evidence for each fix: `docs/research.md` section 3.

| # | Patch | What it fixes |
|---|---|---|
| 0001 | remove-log-upload | Deletes `LogSender` (POSTed logcat to a Vercel relay), makes `getLogSenderChatId()` return null, turns `sendLogs` into a no-op |
| 0002 | disable-public-logcat-dump | `startLogcat()` wrote the whole device logcat to public `Downloads/logs` on every start |
| 0003 | hiddenapibypass-replaces-freereflection | Drops the JitPack dependency; uses LSPosed AndroidHiddenApiBypass (Apache-2.0, Maven Central) |
| 0004 | fileutils-no-shell-strings | `chmod` / `ln -s` fallbacks built shell strings from paths; now argument arrays |
| 0005 | async-engine-startup | Adds `BlackBoxCore.doCreateAsync(ReadyCallback)` and `isCoreReady()` so the UI process never blocks on startup |
| 0006 | grant-network-perms-stop-sms-autogrant | Grants the six network permissions to clone packages (fixes WebView `ERR_CACHE_MISS`, upstream #68); stops reporting `SEND_SMS` as granted |
| 0007 | identity-store-and-hooks | New `IdentityStore`; Android ID (settings provider), IMEI/MEID/IMSI and Wi-Fi hooks now serve per-clone values instead of `md5(hostPackage)` and a fixed `BlackBox_Wifi` |
| 0008 | native-per-clone-spoof-and-maps-filter | Replaces the hard-coded global Pixel 6 / Android 12 property table with a per-process table; adds a `/proc/<pid>/maps` filter |
| 0009 | raise-sdk-levels | Engine root build: compileSdk 36, targetSdk 36, minSdk 24, NDK variable |
| 0010 | native-per-clone-proxy | In-process SOCKS5 / HTTP CONNECT proxy, proxied DNS, UDP block (functionally tested on a Linux host) |
| 0011 | per-clone-notification-label | `NotificationLabel` adds a per-clone sub text to every notification the clone posts |
| 0012 | async-startup-report-real-failure | `doCreateAsync` reports failure honestly and allows a retry |
| 0013 | proxy-dual-stack-and-webview-internet-permission | Proxy hook: v4-mapped (`::ffff:198.18.x.x`) targets from Java's dual-stack sockets are resolved to the fake-DNS hostname, and an IPv4 proxy is reached from AF_INET6 sockets via a v4-mapped address (was `ConnectException`). Adds `checkPermissionForDevice` (Android 15+) so WebView sees INTERNET as granted (was `ERR_CACHE_MISS`) |
| 0014 | stability-fixes-and-faster-proxy-handshake | Service connections are forwarded as raw transactions, so they work whatever parameter list `IServiceConnection.connected` has on the running Android (upstream #60). Takes upstream PRs #72, #73, #74, #75, #78, #79, #80, #81 (SecurityException and null-unboxing crashes, dead clone processes and stale tasks, AppOps return types, PendingIntent results) and the duplicate-launch guard and 10 s launch timeout from #77. SOCKS5 handshake in one round trip instead of three, with automatic fallback for proxies that need step-by-step |
| 0015 | android17-package-list-type-and-small-packageinfo | List results are built in the type the hooked method really returns (Android 17: `getInstalledPackages` returns `PackageInfoList`; returning `ParceledListSlice` crashed Facebook with ClassCastException). All components of a `PackageInfo` share one `ApplicationInfo` object, so the parcel is squashed like the system's (Facebook's was 6 MB and failed the 1 MB binder limit) |
| 0016 | sim-properties-per-slot-and-quiet-property-hook | Spoofed `gsm.*` properties take the per-slot shape of the real value, so the SIM operator, country and name are no longer empty when the active SIM is not in slot 0. The property hook reads names inside the real callback instead of the deprecated `__system_property_read`, which truncated long names and logged an error on every framework cache check |
| 0017 | retry-with-host-package-on-securityexception | Calls with no specific hook that fail with SecurityException because the clone's package name does not belong to the host uid are repeated once with the host package (YouTube: `IMediaRouterService.getSystemRoutes`; Google Play services: `IDevicePolicyManager.getAccountTypesWithManagementDisabledAsUser`) |
| 0018 | locale-manager-and-null-service-intent | `ILocaleManager` proxy (from upstream PR #62, corrected to proxy the interface): `setApplicationLocales` is acknowledged and dropped instead of failing with SecurityException (YouTube). Service restarts with a null intent no longer crash the clone (Google Play services) |

To add a fix: edit `engine/`, then `git -C engine diff > patches/00NN-name.patch`, commit the patch file, and
re-run `scripts/fetch-engine.sh` to prove the whole series still applies from scratch.
