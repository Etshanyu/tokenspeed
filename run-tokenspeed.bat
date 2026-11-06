@echo off
title Token Speed
cd /d C:\Users\Administrator\Desktop\developer\console\tokenspeed
set NO_COLOR=
set FORCE_COLOR=3
powershell.exe -NoProfile -Command "[Console]::Write(([char]27)+']11;#020610'+([char]7)+([char]27)+']10;#e8fbff'+([char]7)+([char]27)+'[48;2;2;6;16m'+([char]27)+'[38;2;232;251;255m'+([char]27)+'[2J'+([char]27)+'[H')"
"C:\Program Files\nodejs\node.exe" --import tsx src/main.tsx %*
echo.
echo Token Speed stopped. Press any key to close.
pause >nul
