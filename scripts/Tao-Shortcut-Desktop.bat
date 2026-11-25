@echo off
setlocal
cd /d "%~dp0.."
echo Dang tao loi tat (Desktop Shortcut) cho LiveSub Studio...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$desktop = [Environment]::GetFolderPath('Desktop'); " ^
  "$s = $ws.CreateShortcut(\"$desktop\LiveSub Studio.lnk\"); " ^
  "if (Test-Path 'LiveSub-Desktop.exe') { $s.TargetPath = (Resolve-Path 'LiveSub-Desktop.exe').Path } else { $s.TargetPath = (Resolve-Path 'start.bat').Path }; " ^
  "$s.WorkingDirectory = (Get-Location).Path; " ^
  "$s.Description = 'LiveSub & VoiceDub AI Desktop Studio'; " ^
  "if (Test-Path 'public\icon.ico') { $s.IconLocation = (Resolve-Path 'public\icon.ico').Path } else { $s.IconLocation = '%SystemRoot%\System32\shell32.dll,220' }; " ^
  "$s.Save(); " ^
  "Write-Host '[THANH CONG] Da tao loi tat LiveSub Studio tren Desktop!' -ForegroundColor Green"

pause
