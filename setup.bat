@echo off
title Cai dat LiveSub & VoiceDub AI Studio
color 0A
echo ========================================================
echo       CAI DAT LIVESUB & VOICEDUB AI STUDIO
echo   He Thong Thuyet Minh & Long Tieng Realtime Da Nguon
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/3] Kiem tra Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo [LOI] Khong tim thay Python tren he thong!
    echo Vui long cai dat Python 3.10 tro len va tich vao "Add Python to PATH".
    pause
    exit /b
)

echo [2/3] Tao moi truong Python ao .venv...
if not exist ".venv" (
    python -m venv .venv
)

echo [3/3] Cai dat cac thu vien can thiet tu requirements.txt...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt

echo.
echo ========================================================
echo   CAI DAT HOAN TAT!
echo   Hay khoi dong bang cach chay file start.bat
echo ========================================================
pause
