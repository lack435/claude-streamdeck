@echo off
rem Installs the reporter as a hidden login item for the current user, and starts it now.
setlocal
set "DIR=%~dp0"
set "VBS=%DIR%run-hidden.vbs"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK=%STARTUP%\ClaudeStreamdeckReporter.lnk"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%VBS%\"'; $s.WorkingDirectory='%DIR%'; $s.Save()"

echo Installed startup item:
echo   %LNK%
echo.
echo Starting reporter now (runs hidden)...
start "" wscript.exe "%VBS%"
echo.
echo Done. This machine will report waiting agents at every login.
pause
