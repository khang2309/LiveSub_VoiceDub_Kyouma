@echo off
title Cai dat LiveSub & VoiceDub AI Studio
color 0A
echo ========================================================
echo       CAI DAT LIVESUB & VOICEDUB AI STUDIO
echo   He Thong Thuyet Minh & Long Tieng Realtime Da Nguon
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/5] Kiem tra Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo [LOI] Khong tim thay Python tren he thong!
    echo Vui long cai dat Python 3.10 tro len va tich vao "Add Python to PATH".
    pause
    exit /b
)

echo [2/5] Tao moi truong Python ao .venv...
if not exist ".venv" (
    python -m venv .venv
)

echo [3/5] Cai dat CUDA PyTorch va cac thu vien can thiet...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install torch==2.8.0+cu128 torchaudio==2.8.0+cu128 --index-url https://download.pytorch.org/whl/cu128
if errorlevel 1 goto :install_error
".venv\Scripts\python.exe" -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cu128
if errorlevel 1 goto :install_error

echo [4/5] Tai va toi uu model dich VinAI EN-VI local INT8...
if not exist "models\vinai-translate-en2vi-v2-int8\model.bin" (
    ".venv\Scripts\ct2-transformers-converter.exe" --model vinai/vinai-translate-en2vi-v2 --output_dir models\vinai-translate-en2vi-v2-int8 --quantization int8 --copy_files sentencepiece.bpe.model
    if errorlevel 1 goto :install_error
) else (
    echo Model VinAI INT8 da co, bo qua tai lai.
)

echo [5/5] Tai model NLLB-200 da ngon ngu local INT8...
if not exist "models\nllb-200-distilled-600M-int8\model.bin" (
    ".venv\Scripts\ct2-transformers-converter.exe" --model facebook/nllb-200-distilled-600M --output_dir models\nllb-200-distilled-600M-int8 --quantization int8 --copy_files sentencepiece.bpe.model tokenizer.json tokenizer_config.json special_tokens_map.json
    if errorlevel 1 goto :install_error
) else (
    echo Model NLLB-200 INT8 da co, bo qua tai lai.
)

echo.
echo ========================================================
echo   CAI DAT HOAN TAT!
echo   Hay khoi dong bang cach chay file start.bat
echo ========================================================
pause
exit /b 0

:install_error
echo.
echo [LOI] Cai dat khong hoan tat. Kiem tra ket noi mang va dung luong dia.
pause
exit /b 1
