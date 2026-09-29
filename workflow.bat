@echo off
setlocal
cd /d "%~dp0"

set "REPO=TheROMZ52/aydream-bot"

powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $w=@(gh workflow list --repo '%REPO%' --json name,path,state | ConvertFrom-Json); if($w.Count -eq 0){Write-Host 'No workflows found.'; exit 1}; $i=0; try{[Console]::CursorVisible=$false; while($true){Clear-Host; Write-Host 'Aydream GitHub Actions'; Write-Host '====================='; Write-Host 'Use Up/Down arrows, then press Enter.'; Write-Host ''; for($n=0;$n -lt $w.Count;$n++){if($n -eq $i){Write-Host ('> '+$w[$n].name+' ['+$w[$n].state+']')}else{Write-Host ('  '+$w[$n].name+' ['+$w[$n].state+']')}}; $key=[Console]::ReadKey($true); switch($key.Key){'UpArrow'{$i=($i-1+$w.Count)%$w.Count};'DownArrow'{$i=($i+1)%$w.Count};'Enter'{break}}}}finally{[Console]::CursorVisible=$true}; Clear-Host; $selected=$w[$i]; Write-Host ('Running: '+$selected.name); gh workflow run $selected.path --repo '%REPO%' --ref main; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}; Write-Host ''; Write-Host 'Workflow started successfully.'"
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
