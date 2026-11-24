@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title LiveSub & VoiceDub AI Desktop App

:: 1. Kiem tra va khoi dong backend livesub.exe neu chua chay
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo Dang khoi dong LiveSub Engine...
    set "EXE_PATH="
    if exist "livesub.exe" (
        set "EXE_PATH=livesub.exe"
    ) else if exist "bin\livesub.exe" (
        set "EXE_PATH=bin\livesub.exe"
    ) else if exist "rust\target\release\livesub.exe" (
        set "EXE_PATH=rust\target\release\livesub.exe"
    )

    if defined EXE_PATH (
        start "" /b "!EXE_PATH!"
    ) else (
        echo [LOI] Khong tim thay binary livesub.exe!
        pause
        exit /b 1
    )

    :: Doi server san sang
    for /l %%i in (1,1,20) do (
        netstat -ano | findstr ":3000" | findstr "LISTENING" >nul 2>&1
        if not errorlevel 1 goto SERVER_READY
        ping 127.0.0.1 -n 1 >nul
    )
)

:SERVER_READY

:: 2. Tim trinh duyet co ho tro che do App Mode (Edge hoac Chrome)
set "APP_BROWSER="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    set "APP_BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    set "APP_BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) else if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set "APP_BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set "APP_BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
)

:: 3. Mo cua so Native Desktop App rieng biet
if defined APP_BROWSER (
    "!APP_BROWSER!" --app="http://localhost:3000" --window-size=1380,880 --user-data-dir="%~dp0.app_profile"
) else (
    start http://localhost:3000
)

:: 4. Khi dong cua so app, tu dong don dep tien trinh backend
powershell -NoProfile -ExecutionPolicy Bypass -Command "$conns = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue; if ($conns) { $conns | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }" >nul 2>&1
