@echo off
setlocal
cd /d "%~dp0"

set "REPO=TheROMZ52/aydream-bot"

powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $w = @(gh workflow list --repo '%REPO%' --json name,path,state | ConvertFrom-Json); if($w.Count -eq 0){Write-Host 'No workflows found.'; exit 1}; $i=0; [Console]::CursorVisible=$false; try { while($true){ Clear-Host; Write-Host 'Aydream GitHub Actions'; Write-Host '====================='; Write-Host 'Use Up/Down arrows, then press Enter.'; Write-Host ''; for($n=0;$n -lt $w.Count;$n++){ if($n -eq $i){ Write-Host ('> ' + $w[$n].name + ' [' + $w[$n].state + ']') } else { Write-Host ('  ' + $w[$n].name + ' [' + $w[$n].state + ']') } }; $k=[Console]::ReadKey($true); if($k.Key -eq 'UpArrow'){$i=($i-1+$w.Count)%$w.Count}; if($k.Key -eq 'DownArrow'){$i=($i+1)%$w.Count}; if($k.Key -eq 'Enter'){break} } } finally {[Console]::CursorVisible=$true}; Clear-Host; Write-Host ('Running: ' + $w[$i].name); gh workflow run $w[$i].path --repo '%REPO%' --ref main; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}; Write-Host ''; Write-Host 'Workflow started successfully.'"
if errorlevel 1 (
  echo.
  echo Failed to start workflow.
  echo Make sure GitHub CLI is installed and authenticated.
  pause
  exit /b 1
)

echo.
pause
exit /b 0
