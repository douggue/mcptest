# Third-party code and notices

| Component | Licence | How it is used |
|---|---|---|
| NewBlackbox (github.com/ALEX5402/NewBlackbox) | Apache-2.0 | Fetched at a pinned commit into `engine/` by `scripts/fetch-engine.sh`, never copied into this repository. Its `LICENSE` and notices stay in `engine/`. Our fixes are in `patches/` |
| BlackBox (FBlackBox) and VirtualApp lineage | Apache-2.0 notice carried in NewBlackbox's LICENSE | Upstream of the engine |
| Dobby (jmpews), xDL (hexhacking) | Apache-2.0 / MIT | Vendored inside the engine |
| AndroidHiddenApiBypass (LSPosed) | Apache-2.0 | Maven Central dependency of the engine after patch 0003 |
| Inter, Space Grotesk, JetBrains Mono | SIL OFL 1.1 | `app/src/main/res/font/`; licences in `third_party/fonts/` |
| AndroidX, Jetpack Compose, Material 3 | Apache-2.0 | Gradle dependencies |
| kotlinx.coroutines | Apache-2.0 | Gradle dependency |

When you distribute a build, include the engine's `LICENSE` and the NOTICE text above in the app's open-source
licences screen. CloneSpace's own licence has not been chosen yet; that is the owner's decision.
