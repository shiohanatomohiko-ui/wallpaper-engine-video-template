# Wallpaper Engine 视频壁纸模板

把自己的视频换进模板，即可制作带鼠标视差、可调时区和立体玻璃时钟的视频壁纸。无需修改 HTML、CSS 或 JavaScript。模板面向 Windows 上的 Wallpaper Engine **2.8.42 Steam 版**，随附可运行演示视频。

## 快速开始

1. 在本仓库点击 **Code → Download ZIP**，或下载提供的 ZIP 项目包，并完整解压。不要直接在压缩包中运行脚本。
2. 首次制作前，联网双击 **`准备制作工具.cmd`**，等待 FFmpeg / ffprobe 下载和校验完成。工具只保存在本模板内，不需要系统安装。
3. 复制准备好的整个模板文件夹，为新作品建立独立工作副本。每个视频使用一个工作副本。
4. 双击副本中的 **`替换视频.cmd`** 选择视频，也可把一个视频拖到该程序上。等待成功提示；视频、启动海报、列表预览及项目标题会同步更新。
5. 双击 **`安装为新项目.cmd`**。工具查找 Steam 库，在 Wallpaper Engine 的 `projects/myprojects/` 下创建唯一的新目录。
6. 打开 Wallpaper Engine，在“已安装”中选择该项目。必要时重新打开选择器刷新，或用壁纸编辑器打开工具输出目录中的 `project.json`。

只有首次取得制作工具需要联网。之后的转换在本地完成；**壁纸运行始终不依赖网络，也无需继续运行制作工具。**只想试用随附演示壁纸时，可直接执行安装步骤，无需先下载 FFmpeg。

自动安装找不到 Wallpaper Engine 时，将 `wallpaper` 文件夹复制到实际安装位置的 `projects/myprojects/` 下，给副本使用独立的新目录名。不要把 `tools` 或备份放进壁纸项目。

更完整的操作、全部参数、备份恢复和排错说明，见 [操作手册.html](操作手册.html)。下载后双击它即可离线阅读或打印；纯文本速览见 [说明.txt](说明.txt)。

## 已配置的效果

- 双播放器提前解码与短淡入循环，包含片尾保护和快速暂停恢复处理。
- 鼠标连续位置驱动的平滑背景视差，自动计算覆盖余量。
- 半透明时钟：可调大小、不透明度、位置、时区、12/24 小时制及秒显示。
- 时钟在鼠标经过时轻微滑动和倾斜，互动强度可调，也可关闭。
- 默认北京时间 UTC+8，基于系统真实时间刷新，不随 Windows 所在时区改变。
- 视频按原比例居中覆盖，时钟布局与视频分辨率分开计算。

## 视频要求与边界

- 使用至少 **2 秒的 SDR 视频**，工具接受 MP4、MOV、MKV、WebM。
- 符合条件的 VP8/VP9 WebM 可快速复制视频流；其他输入实际转换为 VP9 WebM。把 MP4 改名为 WebM 不会转换格式。
- 输出移除音轨。常规素材保留分辨率和帧率；特殊像素比例或奇数尺寸会作兼容性规范化。
- 不强制放大到 4K，不插帧，不增加原片没有的细节。16:9、3840×2160 最适合 4K 桌面。
- 不同比例采用等比居中覆盖，会有裁切；不会自动识别人脸。时钟遮挡主体时，可调整位置和尺寸。
- 短淡入能柔化衔接，但无法让首尾镜头、动作差异很大的任意视频成为完全无缝循环。

每次换源后，请在 Wallpaper Engine 中观察几个完整循环，检查鼠标四角、主体裁切、时钟位置及暂停恢复。普通浏览器预览不能代替宿主中的实际检查；此前的模板验证不代表所有未来素材都已验证。

## 文件与安装副本

```text
准备制作工具.cmd       首次取得本地 FFmpeg / ffprobe
替换视频.cmd           选择视频并生成配套资源
安装为新项目.cmd       创建独立的本地壁纸项目
说明.txt               快速说明
操作手册.html          离线操作手册
tools/                 制作期脚本与依赖说明
wallpaper/             真正的壁纸运行项目
  index.html
  project.json
  preview.jpg
  assets/video.webm
  assets/poster.jpg
  css/
  js/
```

**安装和向 Steam 创意工坊发布时，只使用 `wallpaper/` 内的运行内容。**制作工具、备份、源视频及本机日志不要放进作品目录。

替换成功前不会改写现有素材，也不会改写源视频。旧资源会备份到工作副本的 `backups/时间戳/`，位于 `wallpaper/` 之外。

工作副本与已安装项目是两份文件。重新运行安装工具会创建另一个新项目；若要更新自己已安装的同一个作品，请同步 `assets/video.webm`、`assets/poster.jpg` 和 `preview.jpg`，并保留该项目自己的 `project.json`。详细步骤见操作手册第 4 节。

模板没有预设的工坊条目关联，不会自动切换桌面或上传。以后发布新作品及更新同一作品，应从 Wallpaper Engine 中打开相应项目自行操作。

## 代码、素材与第三方依赖

此版本**尚未为模板代码及演示素材另行指定开源许可证**。公开仓库不等于自动授予开源许可；演示素材未附加开源许可。制作新作品时，请换成自己可使用、可发布的视频。

FFmpeg / ffprobe 是独立的第三方制作工具，按其自身许可证提供。仓库不包含其可执行文件；准备脚本从指定来源下载并校验。来源、版本与许可说明见 [第三方工具说明](tools/第三方工具说明.txt)。运行壁纸本身不使用 FFmpeg，也没有 npm、CDN 或远程字体依赖。

## 官方资料

- [Wallpaper Engine Web 壁纸与支持格式](https://docs.wallpaperengine.io/en/web/overview.html)
- [用户属性](https://docs.wallpaperengine.io/en/web/customization/properties.html)
- [属性、FPS 与暂停回调](https://docs.wallpaperengine.io/en/web/api/propertylistener.html)

## English summary

A reusable video wallpaper template for **Wallpaper Engine 2.8.42 on Windows**, with smooth mouse parallax, predecoded two-player looping, and an interactive glass clock with adjustable timezone, size, opacity and position.

Download and extract the ZIP. Run `准备制作工具.cmd` once with internet access to obtain and verify FFmpeg / ffprobe. Copy the prepared template for each project, run `替换视频.cmd` to select your video, then run `安装为新项目.cmd` and select the new wallpaper in Wallpaper Engine. Video processing is local; wallpaper playback works offline. The bundled demo can be installed without downloading the conversion tools.

Inputs must be **SDR and at least two seconds long**. Output is muted VP8/VP9 WebM; there is no automatic 4K enhancement or frame interpolation. Different aspect ratios are covered with centered cropping. A short transition softens the loop but cannot make arbitrary source footage perfectly seamless.

Only the `wallpaper/` runtime belongs in a Wallpaper Engine project or Workshop upload. The template code and demo media do not currently have a separately granted open-source license. FFmpeg remains subject to its own license.
