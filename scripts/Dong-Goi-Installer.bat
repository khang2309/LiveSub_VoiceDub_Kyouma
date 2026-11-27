@echo off
setlocal
cd /d "%~dp0.."
title Dong Goi LiveSub Studio Installer (Tauri v2)
color 0A

echo ========================================================
echo       DONG GOI CAI DAT LIVESUB STUDIO (TAURI V2)
echo   Tao file setup.exe 1-Click (tu tai AI model lan dau)
echo ========================================================
echo.

if exist "frontend\package.json" (
    echo [1/2] Build giao dien React ^(frontend^)...
    if not exist "frontend\node_modules" (
        call npm --prefix frontend install
    )
    call npm --prefix frontend run build
    if errorlevel 1 (
        echo [LOI] Build React frontend that bai!
        pause
        exit /b 1
    )
)

echo [2/2] Dang dong goi file setup.exe qua Tauri NSIS...
call npx @tauri-apps/cli build --bundles nsis

if errorlevel 1 (
    echo.
    echo [LOI] Qua trinh dong goi gap su co. Vui long kiem tra lai log o tren.
    pause
    exit /b 1
)

for %%F in ("src-tauri\target\release\bundle\nsis\*-setup.exe") do (
    copy /y "%%~fF" "setup.exe" >nul
)

echo.
echo ========================================================
echo [THANH CONG] File cai dat moi da san sang:
echo - C:\dich\setup.exe
echo - src-tauri\target\release\bundle\nsis\
echo ========================================================
echo.
pause
