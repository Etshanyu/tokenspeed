@echo off
title Token Speed
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install Node.js and reopen this terminal.
  pause
  exit /b 1
)
if not exist dist\main.js call npm run build
if errorlevel 1 exit /b 1
powershell.exe -NoProfile -Command "try { [Console]::SetWindowSize(120, 47); [Console]::SetBufferSize(120, 47) } catch { }" >nul 2>nul
set NO_COLOR=
set FORCE_COLOR=3
powershell.exe -NoProfile -Command "[Console]::Write(([char]27)+']11;#020610'+([char]7)+([char]27)+']10;#e8fbff'+([char]7)+'[48;2;2;6;16m'+([char]27)+'[38;2;232;251;255m'+([char]27)+'[2J'+([char]27)+'[H')" >nul 2>nul
node dist\main.js %*
echo.
echo Token Speed stopped. Press any key to close.
pause >nul
