@echo off
title LiveSub & VoiceDub AI Studio
color 0B
echo ========================================================
echo       LIVESUB & VOICEDUB AI STUDIO - REALTIME
echo   He Thong Thuyet Minh & Long Tieng Realtime Da Nguon
echo   (NVIDIA GPU RTX Acceleration + Whisper + Neural TTS)
echo ========================================================
echo.

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [THONG BAO] Chua tim thay moi truong ao .venv!
    echo Dang tu dong chay setup.bat de cai dat...
    call setup.bat
)

echo Dang khoi dong LiveSub Studio tai http://localhost:3000...
start http://localhost:3000
".venv\Scripts\python.exe" server.py

pause
