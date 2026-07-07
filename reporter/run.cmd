@echo off
rem Run the reporter in the foreground. Add --once to write a single report and exit.
setlocal
set "DIR=%~dp0"
if exist "%DIR%node.exe" (set "NODE=%DIR%node.exe") else (set "NODE=node")
"%NODE%" "%DIR%report.mjs" %*
