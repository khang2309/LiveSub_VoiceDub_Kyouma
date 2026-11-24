@echo off
setlocal
cd /d "%~dp0"
title LiveSub Studio Desktop

if exist "LiveSub-Desktop.exe" (
    start "" "LiveSub-Desktop.exe"
) else if exist "src-tauri\target\release\livesub-desktop.exe" (
    start "" "src-tauri\target\release\livesub-desktop.exe"
) else (
    echo [THONG BAO] Chua tim thay LiveSub-Desktop.exe.
    echo Dang khoi dong bang bo khoi chay im lang LiveSub.vbs...
    wscript.exe "LiveSub.vbs"
)
