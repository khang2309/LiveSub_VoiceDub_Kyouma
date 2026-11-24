@echo off
setlocal
cd /d "%~dp0"
echo Dang tao loi tat (Desktop Shortcut) cho LiveSub Studio...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$desktop = [Environment]::GetFolderPath('Desktop'); " ^
  "$s = $ws.CreateShortcut(\"$desktop\LiveSub Studio.lnk\"); " ^
  "if (Test-Path '%~dp0LiveSub-Desktop.exe') { $s.TargetPath = '%~dp0LiveSub-Desktop.exe' } else { $s.TargetPath = '%~dp0LiveSub.vbs' }; " ^
  "$s.WorkingDirectory = '%~dp0'; " ^
  "$s.Description = 'LiveSub & VoiceDub AI Desktop Studio (Tauri v2 Native)'; " ^
  "if (Test-Path '%~dp0public\icon.ico') { $s.IconLocation = '%~dp0public\icon.ico' } else { $s.IconLocation = '%SystemRoot%\System32\shell32.dll,220' }; " ^
  "$s.Save(); " ^
  "Write-Host '[THANH CONG] Da tao loi tat LiveSub Studio tren Desktop!' -ForegroundColor Green"

pause
