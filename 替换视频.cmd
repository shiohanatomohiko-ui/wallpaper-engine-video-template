@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
if "%~1"=="" (
  powershell.exe -NoProfile -STA -File "%~dp0tools\Replace-Video.ps1"
) else (
  powershell.exe -NoProfile -STA -File "%~dp0tools\Replace-Video.ps1" -Source "%~1"
)
set "result=%errorlevel%"
echo.
pause
exit /b %result%
