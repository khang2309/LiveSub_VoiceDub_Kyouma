param(
    [string] $TargetRoot = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = if ($TargetRoot -and $TargetRoot.Trim().Length -gt 0) { $TargetRoot.Trim() } else { Split-Path -Parent $PSScriptRoot }

function Get-FileIfMissing {
    param(
        [Parameter(Mandatory)] [string] $Uri,
        [Parameter(Mandatory)] [string] $Destination,
        [int64] $MinBytes = 1024
    )

    $absolute = Join-Path $root $Destination
    New-Item -ItemType Directory -Force (Split-Path -Parent $absolute) | Out-Null
    if (Test-Path -LiteralPath $absolute) {
        $len = (Get-Item -LiteralPath $absolute).Length
        if ($len -ge $MinBytes) {
            Write-Host "OK   $Destination ($len bytes)"
            return
        }
    }

    Write-Host "GET  $Destination ..."
    $temporary = "$absolute.download"
    Invoke-WebRequest -Uri $Uri -OutFile $temporary -UseBasicParsing
    $len = (Get-Item -LiteralPath $temporary).Length
    if ($len -lt $MinBytes) {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
        throw "Downloaded file too small for $Destination ($len bytes)"
    }
    Move-Item -LiteralPath $temporary -Destination $absolute -Force
    Write-Host "DONE $Destination ($len bytes)"
}

function Expand-VieneuHeadsFromNpz {
    param(
        [Parameter(Mandatory)] [string] $NpzRelative,
        [Parameter(Mandatory)] [string] $OutDirRelative
    )
    $npzPath = Join-Path $root $NpzRelative
    $outDir = Join-Path $root $OutDirRelative
    New-Item -ItemType Directory -Force $outDir | Out-Null

    $expected = @('text_emb', 'audio_emb', 'xvec_w', 'xvec_b', 'xvec_ln_w', 'xvec_ln_b', 'xvec_ln_eps')
    $allExist = $true
    foreach ($name in $expected) {
        if (-not (Test-Path -LiteralPath (Join-Path $outDir "$name.bin"))) {
            $allExist = $false
            break
        }
    }
    if ($allExist) {
        Write-Host "OK   $OutDirRelative\*.bin"
        return
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($npzPath)
    try {
        foreach ($entry in $zip.Entries) {
            if (-not $entry.Name.EndsWith('.npy')) { continue }
            $baseName = [System.IO.Path]::GetFileNameWithoutExtension($entry.Name)
            $stream = $entry.Open()
            try {
                $ms = New-Object System.IO.MemoryStream
                $stream.CopyTo($ms)
                $bytes = $ms.ToArray()
                $major = $bytes[6]
                if ($major -eq 1) {
                    $hlen = [BitConverter]::ToUInt16($bytes, 8)
                    $offset = 10 + $hlen
                } else {
                    $hlen = [BitConverter]::ToUInt32($bytes, 8)
                    $offset = 12 + $hlen
                }
                $outPath = Join-Path $outDir "$baseName.bin"
                $fs = [System.IO.File]::OpenWrite($outPath)
                try {
                    $fs.Write($bytes, $offset, $bytes.Length - $offset)
                } finally {
                    $fs.Dispose()
                }
                Write-Host "HEAD $OutDirRelative/$baseName.bin ($($bytes.Length - $offset) bytes)"
            } finally {
                $stream.Dispose()
            }
        }
    } finally {
        $zip.Dispose()
    }
}

Write-Host "=== [1/4] Whisper Large-v3-Turbo (Q5_0) & CUDA Server ==="
Get-FileIfMissing `
    -Uri 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin' `
    -Destination 'models/whisper/ggml-large-v3-turbo-q5_0.bin' `
    -MinBytes 500000000

$whisperExe = Join-Path $root 'models/whisper/cuda/Release/whisper-server.exe'
$ggmlCuda = Join-Path $root 'models/whisper/cuda/Release/ggml-cuda.dll'
if (-not (Test-Path -LiteralPath $whisperExe) -or -not (Test-Path -LiteralPath $ggmlCuda)) {
    $zipPath = Join-Path $root 'models/whisper/whisper-cuda.zip'
    New-Item -ItemType Directory -Force (Split-Path -Parent $zipPath) | Out-Null
    Write-Host "GET  whisper.cpp CUDA 12.4 Windows binaries ..."
    Invoke-WebRequest -Uri 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.6/whisper-bin-win-cuda-12.4.0-x64.zip' -OutFile $zipPath -UseBasicParsing
    $extractDir = Join-Path $root 'models/whisper/cuda'
    New-Item -ItemType Directory -Force $extractDir | Out-Null
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    Write-Host "DONE models/whisper/cuda/Release/whisper-server.exe"
} else {
    Write-Host "OK   models/whisper/cuda/Release/whisper-server.exe"
}

Write-Host "=== [2/4] VieNeu-TTS v3 Turbo ONNX & sea-g2p ==="
$vieneuBase = 'https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo/resolve/main/onnx_update'
Get-FileIfMissing -Uri "$vieneuBase/config.json" -Destination 'models/vieneu/config.json' -MinBytes 500
Get-FileIfMissing -Uri "$vieneuBase/tokenizer.json" -Destination 'models/vieneu/tokenizer.json' -MinBytes 5000
Get-FileIfMissing -Uri "$vieneuBase/vieneu_prefill.onnx" -Destination 'models/vieneu/vieneu_prefill.onnx' -MinBytes 100000
Get-FileIfMissing -Uri "$vieneuBase/vieneu_decode_step.onnx" -Destination 'models/vieneu/vieneu_decode_step.onnx' -MinBytes 100000
Get-FileIfMissing -Uri "$vieneuBase/vieneu_acoustic_cached.onnx" -Destination 'models/vieneu/vieneu_acoustic_cached.onnx' -MinBytes 1000000
Get-FileIfMissing -Uri "$vieneuBase/vieneu_backbone_shared.data" -Destination 'models/vieneu/vieneu_backbone_shared.data' -MinBytes 300000000
Get-FileIfMissing -Uri "$vieneuBase/vieneu_v3_heads.npz" -Destination 'models/vieneu/vieneu_v3_heads.npz' -MinBytes 40000000
Expand-VieneuHeadsFromNpz -NpzRelative 'models/vieneu/vieneu_v3_heads.npz' -OutDirRelative 'models/vieneu_heads'

Get-FileIfMissing `
    -Uri 'https://raw.githubusercontent.com/pnnbao97/sea-g2p/main/python/sea_g2p/sea_g2p.bin' `
    -Destination 'models/vieneu/sea_g2p.bin' `
    -MinBytes 50000000

Write-Host "=== [3/4] MOSS Audio Tokenizer Codec ==="
$mossBase = 'https://huggingface.co/OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX/resolve/main'
Get-FileIfMissing -Uri "$mossBase/moss_audio_tokenizer_decode_full.onnx" -Destination 'models/moss_codec/moss_audio_tokenizer_decode_full.onnx' -MinBytes 500000
Get-FileIfMissing -Uri "$mossBase/moss_audio_tokenizer_decode_shared.data" -Destination 'models/moss_codec/moss_audio_tokenizer_decode_shared.data' -MinBytes 30000000

Write-Host "=== [4/4] OCR ONNX Models (VI, JA, EN, ZH, KO, TH) ==="
Get-FileIfMissing `
    -Uri 'https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_det_infer.onnx' `
    -Destination 'models/ocr/ch_PP-OCRv4_det_infer.onnx' `
    -MinBytes 3000000
Get-FileIfMissing `
    -Uri 'https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx' `
    -Destination 'models/ocr/ch_PP-OCRv4_rec_infer.onnx' `
    -MinBytes 5000000
Get-FileIfMissing `
    -Uri 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/thai/rec.onnx' `
    -Destination 'models/ocr/th_PP-OCRv5_rec_infer.onnx' `
    -MinBytes 5000000
Get-FileIfMissing `
    -Uri 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/thai/dict.txt' `
    -Destination 'models/ocr/th_dict.txt' `
    -MinBytes 500

Write-Host 'All models (Whisper Large-v3-Turbo CUDA, VieNeu-TTS, MOSS, OCR 6 languages) are ready!'
