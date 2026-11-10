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

To add a fix: edit `engine/`, then `git -C engine diff > patches/00NN-name.patch`, commit the patch file, and
re-run `scripts/fetch-engine.sh` to prove the whole series still applies from scratch.
