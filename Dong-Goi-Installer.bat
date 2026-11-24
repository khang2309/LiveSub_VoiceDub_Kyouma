@echo off
setlocal
cd /d "%~dp0"
title Dong Goi LiveSub Studio Installer (Tauri v2)
color 0A

echo ========================================================
echo       DONG GOI CAI DAT LIVESUB STUDIO (TAURI V2)
echo   Tao file LiveSub Studio Setup (.exe / .msi) tu dong
echo ========================================================
echo.

echo Dang khoi tao tien trinh dong goi Tauri...
echo (Luu y: Lan dau tien co the mat 3-5 phut de toi uu hoa ma nguon)
echo.

call npx @tauri-apps/cli build --bundles nsis

if errorlevel 1 (
    echo.
    echo [LOI] Qua trinh dong goi gap su co. Vui long kiem tra lai log o tren.
    pause
    exit /b 1
)

echo.
echo ========================================================
echo [THANH CONG] File cai dat da duoc tao tai:
echo src-tauri\target\release\bundle\nsis\
echo ========================================================
echo.
pause
