@echo off
title Cai dat LiveSub & VoiceDub AI Studio (100%% Pure Rust)
color 0A
echo ========================================================
echo       CAI DAT LIVESUB & VOICEDUB AI STUDIO
echo   He Thong Thuyet Minh & Long Tieng Realtime Da Nguon
echo   Kien Truc: 100%% Pure Rust Standalone Engine (Zero Python)
echo ========================================================
echo.

cd /d "%~dp0"

echo [1/3] Kiem tra Rust & Cargo...
cargo --version >nul 2>&1
if errorlevel 1 (
    echo [LOI] Khong tim thay Rust/Cargo tren he thong!
    echo Vui long cai dat Rust tu https://rustup.rs/
    pause
    exit /b 1
)

echo [2/3] Build binary Rust LiveSub Engine Release...
cargo build --release --manifest-path rust/livesub-app/Cargo.toml
if errorlevel 1 (
    echo [LOI] Build Rust that bai!
    pause
    exit /b 1
)

if not exist "bin" mkdir "bin" >nul 2>&1
copy /y "rust\target\release\livesub.exe" "livesub.exe" >nul 2>&1
copy /y "rust\target\release\livesub.exe" "bin\livesub.exe" >nul 2>&1

echo [3/3] Kiem tra mo hinh Whisper CUDA va VietOCR...
if not exist "models\whisper\ggml-tiny.bin" (
    echo [CANH BAO] Chua tim thay models\whisper\ggml-tiny.bin
)
if not exist "models\ocr\ch_PP-OCRv4_det_infer.onnx" (
    echo [CANH BAO] Chua tim thay models\ocr\ch_PP-OCRv4_det_infer.onnx
)
if not exist "models\ocr\vietocr_viesvtr_v7.onnx" (
    echo [CANH BAO] Chua tim thay models\ocr\vietocr_viesvtr_v7.onnx
)
if not exist "models\ocr\vietocr_keys.txt" (
    echo [CANH BAO] Chua tim thay models\ocr\vietocr_keys.txt
)

echo.
echo ========================================================
echo   CAI DAT HOAN TAT THANH CONG!
echo   Ban co the chay start.bat de khoi dong LiveSub Studio.
echo ========================================================
pause
