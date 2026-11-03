[CmdletBinding()]
param(
    [string]$Source,
    [string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$stage = $null
$backup = $null
$commitStarted = $false
$completed = $false
$files = @('assets\video.webm', 'assets\poster.jpg', 'preview.jpg', 'project.json')

function Write-Utf8([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}
function Get-Field($Object, [string]$Name, $Default = $null) {
    if ($null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]) { return $Object.$Name }
    return $Default
}
function Quote-NativeArgument([string]$Value) {
    # Windows CommandLineToArgvW quoting. No user input is evaluated as shell code.
    return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}
function Invoke-MediaTool([string]$Exe, [string[]]$Arguments, [string]$Name) {
    $outPath = Join-Path $stage ($Name + '.stdout.txt')
    $errPath = Join-Path $stage ($Name + '.stderr.txt')
    $commandArguments = ($Arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' '
    $process = Start-Process -FilePath $Exe -ArgumentList $commandArguments -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $outPath -RedirectStandardError $errPath
    if ($process.ExitCode -ne 0) {
        $tail = @(Get-Content -LiteralPath $errPath -Tail 10 -ErrorAction SilentlyContinue) -join [Environment]::NewLine
        throw "$Name 失败（退出码 $($process.ExitCode)）。$([Environment]::NewLine)$tail"
    }
    return [IO.File]::ReadAllText($outPath)
}
function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}
function Read-MediaInfo([string]$Path, [string]$Name) {
    return (Invoke-MediaTool $script:ffprobe @('-v','error','-select_streams','v:0','-show_streams','-show_format','-of','json',$Path) $Name) | ConvertFrom-Json
}

try {
    if (!$ProjectRoot) { $ProjectRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'wallpaper' }
    $ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
    if ($ProjectRoot -match '(?i)(^|[\\/])workshop([\\/]|$)') { throw '拒绝修改 Workshop 缓存。请在独立模板工作副本中替换视频。' }
    if (!(Test-Path -LiteralPath (Join-Path $ProjectRoot 'project.json') -PathType Leaf)) { throw '找不到 wallpaper\project.json，请保留完整模板目录结构。' }
    $bundleRoot = Split-Path -Parent $ProjectRoot
    $project = Get-Content -LiteralPath (Join-Path $ProjectRoot 'project.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ((Get-Field $project 'workshopid') -or (Get-Field $project 'workshopurl')) {
        throw '该项目已经关联创意工坊。为避免误改已有作品，请从未发布的模板重新复制一个工作副本。'
    }
    if ([string]::IsNullOrWhiteSpace($Source)) {
        Add-Type -AssemblyName System.Windows.Forms
        $dialog = New-Object Windows.Forms.OpenFileDialog
        $dialog.Title = '选择用于新壁纸的视频（原文件不会修改）'
        $dialog.Filter = '视频文件 (*.mp4;*.mov;*.mkv;*.webm)|*.mp4;*.mov;*.mkv;*.webm|所有文件 (*.*)|*.*'
        $dialog.Multiselect = $false
        try {
            if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { Write-Host '已取消，没有修改项目。'; exit 2 }
            $Source = $dialog.FileName
        } finally { $dialog.Dispose() }
    }
    $Source = (Get-Item -LiteralPath $Source -ErrorAction Stop).FullName
    if (!(Test-Path -LiteralPath $Source -PathType Leaf)) { throw '源路径不是文件。' }
    if ([IO.Path]::GetExtension($Source).ToLowerInvariant() -notin @('.mp4','.mov','.mkv','.webm')) { throw '请选择 MP4、MOV、MKV 或 WebM 视频。不能只把扩展名改为 WebM。' }
    if ($Source.Equals((Join-Path $ProjectRoot 'assets\video.webm'), [StringComparison]::OrdinalIgnoreCase)) { throw '不能把当前输出 video.webm 同时作为输入。请使用项目目录以外的源视频。' }
    $ffmpeg = Join-Path $PSScriptRoot 'ffmpeg\ffmpeg.exe'
    $ffprobe = Join-Path $PSScriptRoot 'ffmpeg\ffprobe.exe'
    if (!(Test-Path -LiteralPath $ffmpeg) -or !(Test-Path -LiteralPath $ffprobe)) { throw '缺少 tools\ffmpeg 制作工具。请先双击模板根目录的“准备制作工具.cmd”，完成后再替换视频。' }
    $token = (Get-Date -Format 'yyyyMMdd_HHmmss') + '_' + [Guid]::NewGuid().ToString('N').Substring(0,8)
    $stageParent = Join-Path $bundleRoot '.staging'
    $stage = Join-Path $stageParent ('replace_' + $token)
    New-Item -ItemType Directory -Path (Join-Path $stage 'assets') -Force | Out-Null
    Write-Host '正在检查源视频，原文件不会修改……'
    $info = Read-MediaInfo $Source 'source-info'
    if (@($info.streams).Count -ne 1) { throw '没有找到可用的视频轨道。' }
    $stream = $info.streams[0]
    $duration = 0.0
    if (![double]::TryParse([string](Get-Field $info.format 'duration' ''), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$duration) -or [double]::IsInfinity($duration) -or [double]::IsNaN($duration) -or $duration -lt 2) { throw '请使用至少 2 秒且具有有效时长的普通视频文件；过短视频不适合此模板的双播放器衔接。' }
    $transfer = [string](Get-Field $stream 'color_transfer' '')
    if ($transfer -in @('smpte2084','arib-std-b67')) { throw '检测到 HDR（PQ/HLG）视频。请先制作 SDR 版本，以免直接转换导致颜色或亮度错误。项目未修改。' }
    if ([int]$stream.width -lt 2 -or [int]$stream.height -lt 2) { throw '视频尺寸无效。' }
    $null = Invoke-MediaTool $ffmpeg @('-hide_banner','-v','error','-xerror','-err_detect','explode','-i',$Source,'-map','0:v:0','-an','-sn','-dn','-f','null','NUL') 'source-decode'
    $sar = [string](Get-Field $stream 'sample_aspect_ratio' '1:1')
    $copyCodec = [IO.Path]::GetExtension($Source).Equals('.webm',[StringComparison]::OrdinalIgnoreCase) -and $stream.codec_name -in @('vp8','vp9') -and $stream.pix_fmt -eq 'yuv420p' -and $sar -in @('1:1','N/A','') -and ([int]$stream.width % 2 -eq 0) -and ([int]$stream.height % 2 -eq 0)
    $stageVideo = Join-Path $stage 'assets\video.webm'
    $conversionArgs = @('-hide_banner','-v','error','-xerror','-err_detect','explode','-i',$Source,'-map','0:v:0','-an','-sn','-dn')
    if ($copyCodec) {
        Write-Host '格式已兼容，保留原视频编码并移除音轨……'
        $conversionArgs += @('-c:v','copy')
    } else {
        Write-Host '正在本地转换为 VP9 WebM（大视频可能需要几分钟）……'
        $conversionArgs += @('-vf','scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1','-pix_fmt','yuv420p','-c:v','libvpx-vp9','-crf','20','-b:v','0','-row-mt','1','-cpu-used','4','-fps_mode','passthrough')
    }
    $conversionArgs += @('-y',$stageVideo)
    $null = Invoke-MediaTool $ffmpeg $conversionArgs 'convert'
    $outputInfo = Read-MediaInfo $stageVideo 'output-info'
    if (@($outputInfo.streams).Count -ne 1 -or $outputInfo.streams[0].codec_name -notin @('vp8','vp9')) { throw '输出视频编码验证失败。' }
    $null = Invoke-MediaTool $ffmpeg @('-hide_banner','-v','error','-xerror','-err_detect','explode','-i',$stageVideo,'-map','0:v:0','-an','-f','null','NUL') 'output-decode'
    Write-Host '正在生成与新视频一致的海报和预览图……'
    $null = Invoke-MediaTool $ffmpeg @('-hide_banner','-v','error','-i',$stageVideo,'-frames:v','1','-q:v','2','-update','1','-y',(Join-Path $stage 'assets\poster.jpg')) 'poster'
    $null = Invoke-MediaTool $ffmpeg @('-hide_banner','-v','error','-i',$stageVideo,'-frames:v','1','-vf','scale=512:288:force_original_aspect_ratio=decrease,pad=512:288:(ow-iw)/2:(oh-ih)/2:color=0x20241f','-q:v','2','-update','1','-y',(Join-Path $stage 'preview.jpg')) 'preview'
    $project.title = [IO.Path]::GetFileNameWithoutExtension($Source)
    $project.preview = 'preview.jpg'
    Write-Utf8 (Join-Path $stage 'project.json') ($project | ConvertTo-Json -Depth 32)
    foreach($relative in $files) { if (!(Test-Path -LiteralPath (Join-Path $stage $relative)) -or (Get-Item -LiteralPath (Join-Path $stage $relative)).Length -eq 0) { throw "生成资源缺失：$relative" } }
    $backup = Join-Path (Join-Path $bundleRoot 'backups') $token
    New-Item -ItemType Directory -Path (Join-Path $backup 'assets') -Force | Out-Null
    foreach($relative in $files) {
        if (!(Test-Path -LiteralPath (Join-Path $ProjectRoot $relative))) { throw "现有模板文件缺失：$relative。请从完整模板重新复制。" }
        Copy-Item -LiteralPath (Join-Path $ProjectRoot $relative) -Destination (Join-Path $backup $relative)
    }
    $commitStarted = $true
    foreach($relative in $files) { [IO.File]::Replace((Join-Path $stage $relative), (Join-Path $ProjectRoot $relative), (Join-Path $stage ($relative + '.previous'))) }
    $record = [ordered]@{completedAt=(Get-Date).ToString('o');source=$Source;sourceSha256=(Get-Sha256 $Source);project=$ProjectRoot;duration=$duration;method=$(if($copyCodec){'remux without re-encoding'}else{'VP9 CRF20 SDR conversion'});width=$outputInfo.streams[0].width;height=$outputInfo.streams[0].height;backup=$backup;videoSha256=(Get-Sha256 (Join-Path $ProjectRoot 'assets\video.webm'))}
    Write-Utf8 (Join-Path $backup 'replacement.json') ($record | ConvertTo-Json -Depth 6)
    Write-Utf8 (Join-Path $bundleRoot 'last-replacement.json') ($record | ConvertTo-Json -Depth 6)
    $completed = $true
    Write-Host "完成：$ProjectRoot" -ForegroundColor Green
    Write-Host "旧文件备份：$backup"
    Write-Host '视频、海报、预览图和项目标题均已更新。下一步双击“安装为新项目.cmd”。已导入的旧副本不会自动变化。'
} catch {
    if ($commitStarted -and !$completed -and $backup) {
        try { foreach($relative in $files) { Copy-Item -LiteralPath (Join-Path $backup $relative) -Destination (Join-Path $ProjectRoot $relative) -Force }; Write-Host '已从备份恢复原项目。' }
        catch { Write-Warning "自动恢复未完全成功，请使用备份目录恢复：$backup" }
    }
    Write-Host ('失败：' + $_.Exception.Message) -ForegroundColor Red
    if ($stage) { Write-Host "诊断文件：$stage" }
    exit 1
} finally {
    if ($completed -and $stage -and (Test-Path -LiteralPath $stage)) {
        $resolvedStage = [IO.Path]::GetFullPath($stage)
        $resolvedParent = [IO.Path]::GetFullPath((Join-Path $bundleRoot '.staging')).TrimEnd('\') + '\'
        if ($resolvedStage.StartsWith($resolvedParent,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedStage).StartsWith('replace_')) { Remove-Item -LiteralPath $resolvedStage -Recurse -Force }
    }
}
exit 0
