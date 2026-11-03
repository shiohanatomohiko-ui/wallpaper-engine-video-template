[CmdletBinding()]
param([string]$ArchivePath)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$archiveUrl = 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip'
$expectedHash = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
$stage = $null
$committing = $false
$completed = $false
$existed = @{}
$files = @('ffmpeg.exe', 'ffprobe.exe', 'LICENSE', 'README.txt')

function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

try {
    $toolsRoot = [IO.Path]::GetFullPath($PSScriptRoot)
    $toolRoot = Join-Path $toolsRoot 'ffmpeg'
    $stage = Join-Path $toolsRoot ('.ffmpeg-setup_' + [Guid]::NewGuid().ToString('N'))
    $stagedTools = Join-Path $stage 'new'
    $backupRoot = Join-Path $stage 'previous'
    New-Item -ItemType Directory -Path $stagedTools, $backupRoot -Force | Out-Null

    if ([string]::IsNullOrWhiteSpace($ArchivePath)) {
        $ArchivePath = Join-Path $stage 'ffmpeg-9.0.2-essentials_build.zip'
        Write-Host '正在从 Gyan.dev 下载固定版本 FFmpeg 9.0.2；仅此制作工具步骤需要联网……'
        $oldTls = [Net.ServicePointManager]::SecurityProtocol
        $client = New-Object Net.WebClient
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $client.DownloadFile($archiveUrl, $ArchivePath)
        } finally {
            $client.Dispose()
            [Net.ServicePointManager]::SecurityProtocol = $oldTls
        }
    } else {
        $ArchivePath = (Get-Item -LiteralPath $ArchivePath -ErrorAction Stop).FullName
        if (!(Test-Path -LiteralPath $ArchivePath -PathType Leaf)) { throw '离线压缩包路径不是文件。' }
    }

    Write-Host '正在校验 SHA-256……'
    if ((Get-Sha256 $ArchivePath) -ne $expectedHash) {
        throw '压缩包 SHA-256 不匹配。请使用指定的 FFmpeg 9.0.2 essentials ZIP，已有工具未修改。'
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        # Exact whitelist extraction: archive paths never become filesystem paths.
        $entries = [ordered]@{
            'ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe' = 'ffmpeg.exe'
            'ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe' = 'ffprobe.exe'
            'ffmpeg-9.0.2-essentials_build/LICENSE' = 'LICENSE'
            'ffmpeg-9.0.2-essentials_build/README.txt' = 'README.txt'
        }
        foreach ($entryName in $entries.Keys) {
            $matches = @($zip.Entries | Where-Object { $_.FullName -ceq $entryName })
            if ($matches.Count -ne 1 -or $matches[0].Length -le 0 -or $matches[0].Length -gt 268435456) {
                throw "压缩包必要条目缺失、重复或大小异常：$entryName"
            }
            $destination = Join-Path $stagedTools $entries[$entryName]
            [IO.Compression.ZipFileExtensions]::ExtractToFile($matches[0], $destination, $false)
        }
    } finally { $zip.Dispose() }

    foreach ($exe in @('ffmpeg.exe','ffprobe.exe')) {
        $stdout = Join-Path $stage ($exe + '.stdout.txt')
        $stderr = Join-Path $stage ($exe + '.stderr.txt')
        $process = Start-Process -FilePath (Join-Path $stagedTools $exe) -ArgumentList '-version' -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $versionText = [IO.File]::ReadAllText($stdout)
        if ($process.ExitCode -ne 0 -or $versionText -notmatch 'version 9\.0\.2(?:-|\s)') {
            throw "制作工具启动验证失败：$exe。已有工具未修改。"
        }
    }

    New-Item -ItemType Directory -Path $toolRoot -Force | Out-Null
    foreach ($name in $files) {
        $target = Join-Path $toolRoot $name
        $existed[$name] = Test-Path -LiteralPath $target
        if ($existed[$name]) {
            if (!(Test-Path -LiteralPath $target -PathType Leaf)) { throw "工具目标不是文件：$name" }
            Copy-Item -LiteralPath $target -Destination (Join-Path $backupRoot $name)
        }
    }
    $committing = $true
    foreach ($name in $files) {
        $target = Join-Path $toolRoot $name
        $source = Join-Path $stagedTools $name
        if ($existed[$name]) { [IO.File]::Replace($source, $target, (Join-Path $stage ($name + '.replaced'))) }
        else { [IO.File]::Move($source, $target) }
    }
    $completed = $true
    Write-Host '制作工具已准备好：FFmpeg / FFprobe 9.0.2。现在可以运行“替换视频.cmd”。' -ForegroundColor Green
    Write-Host '工具仅保存在模板的 tools\ffmpeg 中，没有更改 PATH、系统执行策略或 Wallpaper Engine。'
} catch {
    if ($committing -and !$completed) {
        try {
            foreach ($name in $files) {
                $target = Join-Path $toolRoot $name
                if ($existed[$name]) { Copy-Item -LiteralPath (Join-Path $backupRoot $name) -Destination $target -Force }
                elseif (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force }
            }
            Write-Host '已恢复安装前的工具文件。'
        } catch {
            Write-Warning "工具恢复失败；备份保留在：$backupRoot"
            $stage = $null # Preserve the backup if restoration fails.
        }
    }
    Write-Host ('失败：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    if ($stage -and (Test-Path -LiteralPath $stage)) {
        $resolved = [IO.Path]::GetFullPath($stage)
        $expectedParent = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
        if ($resolved.StartsWith($expectedParent,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved) -match '^\.ffmpeg-setup_[a-f0-9]{32}$') {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}
exit 0
