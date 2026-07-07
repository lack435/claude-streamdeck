@echo off
rem Turnkey setup: report this machine's signed-in account at every login (hidden).
rem Safe to re-run to update — it restarts cleanly without stacking processes.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
pause
