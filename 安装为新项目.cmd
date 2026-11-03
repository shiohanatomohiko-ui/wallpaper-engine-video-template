@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
powershell.exe -NoProfile -File "%~dp0tools\Install-Project.ps1"
set "result=%errorlevel%"
echo.
pause
exit /b %result%
