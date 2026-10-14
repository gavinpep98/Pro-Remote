@echo off
rem Adds "Slide Desk" (with its icon) to the Start menu and the desktop.
rem Keep this folder where it is afterwards: the shortcuts open the remote from here.
rem (It also removes old "Pro Remote" shortcuts: Slide Desk used to be called Pro Remote.)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$here = (Get-Location).Path;" ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {" ^
  "  Remove-Item -ErrorAction SilentlyContinue (Join-Path $dir 'Pro Remote.lnk');" ^
  "  $lnk = $ws.CreateShortcut((Join-Path $dir 'Slide Desk.lnk'));" ^
  "  $lnk.TargetPath = (Join-Path $here 'Start Slide Desk (Windows).bat');" ^
  "  $lnk.WorkingDirectory = $here;" ^
  "  $lnk.IconLocation = (Join-Path $here 'assets\icon.ico');" ^
  "  $lnk.Description = 'Slide Desk - browser remote for ProPresenter';" ^
  "  $lnk.Save() }"
if errorlevel 1 (
  echo.
  echo Couldn't create the shortcuts. You can still double-click "Start Slide Desk ^(Windows^).bat".
) else (
  echo.
  echo Done! "Slide Desk" is now in the Start menu and on the desktop.
  echo To pin it to the taskbar: open Start, right-click Slide Desk, More, Pin to taskbar.
  echo Keep this folder where it is: the shortcuts open the remote from here.
)
echo.
pause
