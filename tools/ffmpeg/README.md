# 制作工具 / Authoring tools

GitHub 版本不包含 FFmpeg 可执行文件。第一次制作前，显式双击项目根目录的 **准备制作工具.cmd**。它会从 Gyan.dev 下载下列固定版本，验证 SHA-256，然后仅将 `ffmpeg.exe`、`ffprobe.exe`、`LICENSE` 和 `README.txt` 放入本目录。

- 版本：FFmpeg 9.0.2 essentials build（Windows x64）
- ZIP：https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip
- SHA-256：`60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`
- 构建说明及许可证：https://www.gyan.dev/ffmpeg/builds/
- FFmpeg 官方网站：https://ffmpeg.org/

不修改 PATH 或 PowerShell 执行策略，不要求安装全局软件。运行壁纸不依赖这些制作工具，也不需要联网。下载或校验失败不会替换已有工具。

离线准备：事先取得上述原版 ZIP，将它拖到 **准备制作工具.cmd**，或运行：

```powershell
powershell.exe -NoProfile -File .\tools\Setup-FFmpeg.ps1 -ArchivePath 'C:\Downloads\ffmpeg-9.0.2-essentials_build.zip'
```

脚本只提取四个名称精确匹配的文件，所有输出路径由脚本指定；压缩包内其他路径不会被解压。不要提交或重新上传本地下载的可执行文件、压缩包或临时安装文件。

## English

The GitHub package excludes FFmpeg binaries. Explicitly run **准备制作工具.cmd** once to download the pinned Gyan.dev FFmpeg 9.0.2 essentials ZIP over HTTPS. The script verifies the SHA-256 above and extracts only `ffmpeg.exe`, `ffprobe.exe`, `LICENSE`, and `README.txt` into this folder. It checks both executables before replacing existing tools and restores old files if installation fails.

For offline setup, drag the original ZIP onto the launcher or pass `-ArchivePath` to `tools/Setup-FFmpeg.ps1`. The installer changes neither PATH nor execution policy. These tools are used only when preparing a video; the wallpaper itself remains fully offline.

The downloaded Gyan.dev build is GPLv3; see its extracted `LICENSE` and `README.txt` for build options, source revision, and source links. FFmpeg is a separate third-party dependency and is not covered by the template's code license.
