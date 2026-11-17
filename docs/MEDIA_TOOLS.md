# 内置媒体工具

macOS v0.2.1 安装包自带 FFmpeg 与 FFprobe，无需 Homebrew、系统 FFmpeg 或剪映。它们位于应用的 `Contents/Resources/media-tools/`，作为独立子进程运行。设置中选择的自定义工具或 `REACUT_FFMPEG` / `REACUT_FFPROBE` 环境变量优先；没有覆盖时使用内置工具。内置文件缺失会明确报错，不悄悄使用开发机环境。

## 来源和许可

固定使用 FFmpeg 9.0.2 与 x264 `b35605ace3ddf7c1a5d67a2eb553f034aef41d55` 的官方源码，不修改上游源码。通过 `--enable-gpl --enable-libx264` 构建，所以媒体工具采用 GPL-2.0-or-later；对应源码、原始许可、构建脚本和清单随每个安装包一起提供。ReaCut 自行编写的代码保留 MIT 许可。详情见 [第三方声明](../THIRD_PARTY_NOTICES.md) 和 [FFmpeg 上游许可说明](https://ffmpeg.org/legal.html)。

构建没有启用 `nonfree`。第三方编解码库静态链接，运行依赖仅为 macOS 系统库/框架。网络协议在内置构建中关闭；应用原有的本地文件协议限制仍保留。支持当前 H.264/AAC 导出与经测试的本地媒体处理；未包含 x265 编码器，但已实际验证 HEVC 解码和 H.264 代理生成。

## 重建

在原生 macOS 主机安装 Xcode 命令行工具和项目所需 Node.js 后：

```sh
npm ci
npm run media:build
npm run dist:mac:installer
```

首次下载并校验固定源码，构建隔离的 pkgconf、x264 和 FFmpeg。pkgconf 仅为构建工具，也提供其源码。下载缓存和中间文件位于忽略的 `.media-build/`，最终媒体资源位于忽略的 `media-tools/darwin-<arch>/`。打包钩子自动运行相同校验/构建，避免遗漏资源；不支持跨架构打包。当前只验收了 arm64；x64 构建还需要 NASM，尚未运行验证。

所有上游源码归档、下载 URL、SHA-256、编译参数和许可证路径都在包内 `manifest.json` / `sources/` / `licenses/` 中。仓库留有脱敏的 [构建清单](media-tools-build.json)。清单的 `buildSHA256` 是签名前的指纹，应用签名可能改变可执行文件字节；最终签名后指纹另记录于 [验证摘要](validation-summary.json)。

## Windows x64

Windows 安装包同样自带 `ffmpeg.exe` 与 `ffprobe.exe`，位于安装目录的 `resources/media-tools/`，优先级规则与 macOS 相同。它们由 `scripts/build-media-tools-win.mjs` 在 Linux x64（或 WSL）上用 mingw-w64 交叉编译，使用与 macOS 相同的 FFmpeg 9.0.2 和 x264 固定源码，并从未修改的 zlib 1.3.1 源码静态链接 zlib（Windows 没有系统 zlib）：

```sh
sudo apt-get install gcc-mingw-w64-x86-64 nasm pkg-config make
npm run media:build:win
```

配置与 macOS 一致：`--enable-gpl --enable-libx264`、未启用 `nonfree`、关闭网络协议；线程使用 Windows 原生线程，不启用 VideoToolbox / AudioToolbox。脚本校验源码 SHA-256，并检查可执行文件只导入 Windows 系统 DLL；可执行文件静态包含所用 mingw-w64 工具链的 C 运行时启动代码与 GCC 支持库。输出位于忽略的 `media-tools/win32-x64/`，同样带有 `manifest.json`、`sources/` 与 `licenses/`。

在 Windows 主机上打包时，`npm run dist:win` 只校验已复制进来的 `media-tools/win32-x64/`，不会在 Windows 上编译；在 Linux x64 上打包时会自动运行上述脚本。CI 的 `media-tools-windows` 任务构建工具，`package-windows` 任务用它们运行单元测试、打包并启动安装后的应用。

源码开发仍可使用系统安装的工具；Linux 安装包尚未集成对应平台媒体工具。不要将某一平台的验证外推至其他平台。
