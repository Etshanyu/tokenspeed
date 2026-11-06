@echo off
title Token Speed Python
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  where py >nul 2>nul
  if errorlevel 1 (
    python -m venv .venv
  ) else (
    py -3 -m venv .venv
  )
)
if errorlevel 1 exit /b 1
rem Optional .zst support: .venv\Scripts\python.exe -m pip install -r python\requirements.txt
powershell.exe -NoProfile -Command "try { [Console]::SetWindowSize(120, 50); [Console]::SetBufferSize(120, 50) } catch { }" >nul 2>nul
set "PYTHONPATH=%~dp0python"
set NO_COLOR=
.venv\Scripts\python.exe -m tokenspeed --cache-dir "%~dp0.tokenspeed-cache" %*
echo.
echo Token Speed stopped. Press any key to close.
pause >nul
