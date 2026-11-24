$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Get-VerifiedModel {
    param(
        [Parameter(Mandatory)] [string] $Uri,
        [Parameter(Mandatory)] [string] $Destination,
        [Parameter(Mandatory)] [string] $Sha256
    )

    $absolute = Join-Path $root $Destination
    New-Item -ItemType Directory -Force (Split-Path -Parent $absolute) | Out-Null
    if (Test-Path -LiteralPath $absolute) {
        $actual = (Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash
        if ($actual -eq $Sha256) {
            Write-Host "OK  $Destination"
            return
        }
    }

    $temporary = "$absolute.download"
    Invoke-WebRequest -Uri $Uri -OutFile $temporary
    $actual = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash
    if ($actual -ne $Sha256) {
        Remove-Item -LiteralPath $temporary -Force
        throw "Checksum mismatch for $Destination (received $actual)"
    }
    Move-Item -LiteralPath $temporary -Destination $absolute -Force
    Write-Host "GET $Destination"
}

Get-VerifiedModel `
    -Uri 'https://github.com/deeplabua/deepocr/releases/download/models-v1/text-detection.rten' `
    -Destination 'models/ocrs/text-detection.rten' `
    -Sha256 'F15CFB56BD02C4BF478A20343986504A1F01E1665C2B3A0AD66340F054B1B5CA'

Get-VerifiedModel `
    -Uri 'https://github.com/deeplabua/deepocr/releases/download/models-v1/text-recognition.rten' `
    -Destination 'models/ocrs/text-recognition.rten' `
    -Sha256 'E484866D4CCE403175BD8D00B128FEB08AB42E208DE30E42CD9889D8F1735A6E'

Get-VerifiedModel `
    -Uri 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin' `
    -Destination 'models/whisper/ggml-tiny.bin' `
    -Sha256 'BE07E048E1E599AD46341C8D2A135645097A538221678B7ACDD1B1919C6E1B21'

Write-Host 'Rust OCR and Whisper models are ready.'
