@echo off
rem Removes the login item and stops the running reporter from this folder.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" -Uninstall
pause
