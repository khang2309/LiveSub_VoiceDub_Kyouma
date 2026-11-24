@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title LiveSub - VoiceDub AI Studio
color 0B

echo ========================================================
echo       LIVESUB - VOICEDUB AI STUDIO - REALTIME
echo   He Thong Thuyet Minh va Long Tieng Realtime Da Nguon
echo   100%% PURE RUST STANDALONE ENGINE + ZERO GIL + GPU ACCEL
echo ========================================================
echo.

echo [1/3] Kiem tra va giai phong port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    if not "%%a"=="0" (
        taskkill /F /PID %%a >nul 2>&1
    )
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$conns = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue; if ($conns) { $conns | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }" >nul 2>&1

ping 127.0.0.1 -n 2 >nul

echo.
echo [2/3] Mo trinh duyet tai http://localhost:3000...
start http://localhost:3000

echo.
echo [3/3] Dang khoi dong LiveSub Pure Rust Engine tren port 3000...
echo ========================================================
echo   SERVER DANG CHAY (100%% PURE RUST). KHONG DONG CUA SO NAY!
echo   De tat server, hay bam Ctrl+C hoac dong cua so nay.
echo ========================================================
echo.

set "EXE_PATH="
if exist "livesub.exe" (
    set "EXE_PATH=livesub.exe"
) else if exist "bin\livesub.exe" (
    set "EXE_PATH=bin\livesub.exe"
) else if exist "rust\target\release\livesub.exe" (
    set "EXE_PATH=rust\target\release\livesub.exe"
) else (
    echo [THONG BAO] Chua tim thay binary livesub.exe. Dang tu dong build release...
    cargo build --release --manifest-path rust/livesub-app/Cargo.toml
    if exist "rust\target\release\livesub.exe" (
        copy /y "rust\target\release\livesub.exe" "livesub.exe" >nul 2>&1
        set "EXE_PATH=livesub.exe"
    )
)

if defined EXE_PATH (
    "%EXE_PATH%"
) else (
    echo [LOI] Khong the tim thay hoac build livesub.exe!
)

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [LOI] Server bi dung voi ma loi: %ERRORLEVEL%
    echo Nhan phim bat ky de thoat...
    pause
)
