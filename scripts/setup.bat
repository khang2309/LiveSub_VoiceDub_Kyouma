@echo off
title Cai dat LiveSub & VoiceDub AI Studio (100%% Pure Rust)
color 0A
echo ========================================================
echo       CAI DAT LIVESUB & VOICEDUB AI STUDIO
echo   6 Ngon Ngu: Viet, Nhat, Anh, Trung, Han, Thai
echo   Kien Truc: 100%% Pure Rust Standalone Engine (Zero Python)
echo ========================================================
echo.

cd /d "%~dp0.."

echo [1/4] Kiem tra Rust & Cargo...
cargo --version >nul 2>&1
if errorlevel 1 (
    echo [LOI] Khong tim thay Rust/Cargo tren he thong!
    echo Vui long cai dat Rust tu https://rustup.rs/
    pause
    exit /b 1
)

echo [2/4] Tai va kiem tra day du model AI (Whisper Large-v3-Turbo CUDA, VieNeu-TTS, OCR 6 ngon ngu)...
powershell -NoProfile -ExecutionPolicy Bypass -File "rust\setup-models.ps1"
if errorlevel 1 (
    echo [LOI] Tai model AI that bai! Vui long kiem tra mang va chay lai.
    pause
    exit /b 1
)

echo [3/4] Cai dat dependencies Node.js va build giao dien React (frontend)...
where npm >nul 2>&1
if not errorlevel 1 (
    if not exist "node_modules" (
        call npm install
    )
    if exist "frontend\package.json" (
        if not exist "frontend\node_modules" (
            call npm --prefix frontend install
        )
        call npm --prefix frontend run build
    )
)

echo [4/4] Build binary Rust LiveSub Engine Release...
cargo build --release --manifest-path rust/livesub-app/Cargo.toml
if errorlevel 1 (
    echo [LOI] Build Rust that bai!
    pause
    exit /b 1
)

if not exist "bin" mkdir "bin" >nul 2>&1
copy /y "rust\target\release\livesub.exe" "livesub.exe" >nul 2>&1
copy /y "rust\target\release\livesub.exe" "bin\livesub.exe" >nul 2>&1
copy /y "rust\target\release\*.dll" "." >nul 2>&1

echo.
echo ========================================================
echo   CAI DAT HOAN TAT THANH CONG!
echo   Chay livesub.exe hoac cargo run --release --manifest-path rust/livesub-app/Cargo.toml
echo ========================================================
pause
