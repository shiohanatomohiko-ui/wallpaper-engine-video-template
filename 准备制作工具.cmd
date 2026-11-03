@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
if "%~1"=="" (
  powershell.exe -NoProfile -File "%~dp0tools\Setup-FFmpeg.ps1"
) else (
  powershell.exe -NoProfile -File "%~dp0tools\Setup-FFmpeg.ps1" -ArchivePath "%~1"
)
set "result=%errorlevel%"
echo.
pause
exit /b %result%
