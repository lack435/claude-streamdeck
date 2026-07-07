# Installs (or removes) the reporter as a hidden per-user login item and starts it now.
# Safe to re-run: stops any existing reporter from this folder first (use to update).
param([switch]$Uninstall)
$ErrorActionPreference = 'SilentlyContinue'

$dir = $PSScriptRoot
$vbs = Join-Path $dir 'run-hidden.vbs'
$reportPath = Join-Path $dir 'report.mjs'
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'ClaudeStreamdeckReporter.lnk'

# Stop any reporter already running from this folder (precise match on report.mjs path).
Get-CimInstance Win32_Process |
	Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like "*$reportPath*" } |
	ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

if ($Uninstall) {
	if (Test-Path $lnk) { Remove-Item $lnk; Write-Host "Removed startup item." } else { Write-Host "No startup item found." }
	Write-Host "Reporter stopped. Done."
	return
}

# Create / refresh the login shortcut (launches the reporter hidden via wscript).
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = 'wscript.exe'
$s.Arguments = '"' + $vbs + '"'
$s.WorkingDirectory = $dir
$s.Save()
Write-Host "Installed startup item: $lnk"

# Start it now, hidden.
Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"')
Write-Host "Reporter started (hidden)."
Write-Host "It reports this machine's signed-in account, refreshing every 30s and at each login."
