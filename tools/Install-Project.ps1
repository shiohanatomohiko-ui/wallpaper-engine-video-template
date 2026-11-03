[CmdletBinding()]
param(
    [string]$EngineRoot,
    [string]$DestinationParent,
    [string]$ProjectRoot
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
function Write-Utf8([string]$Path,[string]$Text) { [IO.File]::WriteAllText($Path,$Text,(New-Object Text.UTF8Encoding($false))) }
function Find-Engine {
    $steamRoots = New-Object Collections.Generic.List[string]
    try { $s=(Get-ItemProperty -LiteralPath 'HKCU:\Software\Valve\Steam' -Name SteamPath -ErrorAction Stop).SteamPath; if($s){$steamRoots.Add($s)} } catch {}
    try { $s=(Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam' -Name InstallPath -ErrorAction Stop).InstallPath; if($s){$steamRoots.Add($s)} } catch {}
    foreach($drive in Get-PSDrive -PSProvider FileSystem) { $s=Join-Path $drive.Root 'Steam'; if(Test-Path -LiteralPath $s){$steamRoots.Add($s)} }
    $libraries = New-Object Collections.Generic.List[string]
    foreach($steam in @($steamRoots | Select-Object -Unique)) {
        $libraries.Add($steam)
        $vdf=Join-Path $steam 'steamapps\libraryfolders.vdf'
        if(Test-Path -LiteralPath $vdf) {
            $content=[IO.File]::ReadAllText($vdf)
            foreach($m in [regex]::Matches($content,'"path"\s+"([^"]+)"')) { $libraries.Add($m.Groups[1].Value.Replace('\\','\')) }
        }
    }
    foreach($library in @($libraries | Select-Object -Unique)) {
        $candidate=Join-Path $library 'steamapps\common\wallpaper_engine'
        $manifest=Join-Path $library 'steamapps\appmanifest_431960.acf'
        if((Test-Path -LiteralPath (Join-Path $candidate 'wallpaper64.exe')) -and (Test-Path -LiteralPath $manifest) -and ([IO.File]::ReadAllText($manifest) -match '"appid"\s+"431960"')) { return $candidate }
    }
    throw '未找到 Wallpaper Engine。可在 PowerShell 中运行 tools\Install-Project.ps1 -EngineRoot "实际wallpaper_engine目录"，或按操作手册手动复制 wallpaper 文件夹。'
}
try {
    if (!$ProjectRoot) { $ProjectRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'wallpaper' }
    $ProjectRoot=[IO.Path]::GetFullPath($ProjectRoot)
    foreach($f in @('project.json','index.html','preview.jpg','assets\video.webm','assets\poster.jpg','js\video-loop.js','js\wallpaper.js','css\style.css')) { if(!(Test-Path -LiteralPath (Join-Path $ProjectRoot $f) -PathType Leaf)){throw "模板文件缺失：$f"} }
    if(!$DestinationParent) {
        if(!$EngineRoot) { $EngineRoot=Find-Engine }
        $EngineRoot=[IO.Path]::GetFullPath($EngineRoot)
        if(!(Test-Path -LiteralPath (Join-Path $EngineRoot 'wallpaper64.exe')) -and !(Test-Path -LiteralPath (Join-Path $EngineRoot 'wallpaper32.exe'))) { throw 'EngineRoot 不是有效的 Wallpaper Engine 安装目录。' }
        $DestinationParent=Join-Path $EngineRoot 'projects\myprojects'
    }
    $DestinationParent=[IO.Path]::GetFullPath($DestinationParent)
    if($DestinationParent -match '(?i)(^|[\\/])workshop([\\/]|$)') { throw '拒绝写入 Workshop 缓存。请使用 myprojects 或独立测试目录。' }
    if(!(Test-Path -LiteralPath $DestinationParent -PathType Container)) { throw "目标父目录不存在：$DestinationParent" }
    $name='video_template_'+(Get-Date -Format 'yyyyMMdd_HHmmss')+'_'+[Guid]::NewGuid().ToString('N').Substring(0,8)
    $destination=Join-Path $DestinationParent $name
    if(Test-Path -LiteralPath $destination){throw '目标目录已存在，未覆盖任何文件。请重新运行。'}
    New-Item -ItemType Directory -Path $destination | Out-Null
    foreach($f in @('index.html','project.json','preview.jpg','assets','js','css')) { Copy-Item -LiteralPath (Join-Path $ProjectRoot $f) -Destination $destination -Recurse }
    $meta=Get-Content -LiteralPath (Join-Path $destination 'project.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach($key in @('workshopid','workshopurl','version','visibility')) { if($null -ne $meta.PSObject.Properties[$key]){$meta.PSObject.Properties.Remove($key)} }
    Write-Utf8 (Join-Path $destination 'project.json') ($meta | ConvertTo-Json -Depth 32)
    $bundleRoot=Split-Path -Parent $ProjectRoot
    Write-Utf8 (Join-Path $bundleRoot 'last-installed-project.txt') $destination
    Write-Host '独立项目已安装，原有壁纸和工坊条目均未修改。' -ForegroundColor Green
    Write-Host "项目位置：$destination"
    Write-Host '请重新打开 Wallpaper Engine“已安装”列表，选择这个视频标题；必要时使用编辑器“文件 → 打开”选择新目录的 project.json。'
    Write-Host '仅复制了 wallpaper 运行资源；制作工具、备份及操作手册没有进入壁纸项目。没有自动切换桌面，也没有上传工坊。'
} catch { Write-Host ('安装失败：'+$_.Exception.Message) -ForegroundColor Red; exit 1 }
exit 0
