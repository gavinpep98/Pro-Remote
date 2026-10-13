@echo off
rem Adds "Pro Remote" (with its icon) to the Start menu and the desktop.
rem Keep this folder where it is afterwards: the shortcuts open the remote from here.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$here = (Get-Location).Path;" ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {" ^
  "  $lnk = $ws.CreateShortcut((Join-Path $dir 'Pro Remote.lnk'));" ^
  "  $lnk.TargetPath = (Join-Path $here 'Start Remote (Windows).bat');" ^
  "  $lnk.WorkingDirectory = $here;" ^
  "  $lnk.IconLocation = (Join-Path $here 'assets\icon.ico');" ^
  "  $lnk.Description = 'Pro Remote - browser remote for ProPresenter';" ^
  "  $lnk.Save() }"
if errorlevel 1 (
  echo.
  echo Couldn't create the shortcuts. You can still double-click "Start Remote ^(Windows^).bat".
) else (
  echo.
  echo Done! "Pro Remote" is now in the Start menu and on the desktop.
  echo To pin it to the taskbar: open Start, right-click Pro Remote, More, Pin to taskbar.
  echo Keep this folder where it is: the shortcuts open the remote from here.
)
echo.
pause
