@echo off
rem Removes the reporter login item. A currently-running hidden reporter stops at next logoff
rem (or end "node.exe" for this folder in Task Manager to stop it immediately).
setlocal
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ClaudeStreamdeckReporter.lnk"
if exist "%LNK%" (del "%LNK%" & echo Removed startup item.) else (echo No startup item found.)
pause
