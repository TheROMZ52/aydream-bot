@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "REPO=TheROMZ52/aydream-bot"
set "TMP=%TEMP%\aydream_workflows_%RANDOM%.txt"

gh workflow list --repo "%REPO%" --json name,path,state > "%TMP%"
if errorlevel 1 (
  echo Failed to load workflows.
  echo Make sure GitHub CLI is installed and authenticated.
  pause
  exit /b 1
)

for /f "delims=" %%A in ('powershell -NoProfile -Command "$x=Get-Content -Raw '%TMP%' ^| ConvertFrom-Json; $x ^| ForEach-Object { '{0}^|{1}^|{2}' -f $_.name,$_.path,$_.state }"') do (
  set /a COUNT+=1
  for /f "tokens=1-3 delims=|" %%a in ("%%A") do (
    set "NAME!COUNT!=%%a"
    set "PATH!COUNT!=%%b"
    set "STATE!COUNT!=%%c"
  )
)

del "%TMP%" >nul 2>&1

if not defined COUNT (
  echo No workflows found.
  pause
  exit /b 1
)

set "SELECTED=1"

:menu
cls
echo Aydream GitHub Actions
echo =====================
echo Use Up/Down arrows, then press Enter.
echo.

for /l %%I in (1,1,%COUNT%) do (
  if %%I==!SELECTED! (
    echo ^> !NAME%%I! [!STATE%%I!]
  ) else (
    echo   !NAME%%I! [!STATE%%I!]
  )
)

choice /c JK H /n /m " [Up=J  Down=K  Enter=H] "
if errorlevel 3 goto run
if errorlevel 2 (
  set /a SELECTED+=1
  if !SELECTED! GTR !COUNT! set "SELECTED=1"
  goto menu
)
if errorlevel 1 (
  set /a SELECTED-=1
  if !SELECTED! LSS 1 set "SELECTED=%COUNT%"
  goto menu
)

:run
cls
echo Running: !NAME%SELECTED%!
echo.
gh workflow run "!PATH%SELECTED%!" --repo "%REPO%" --ref main
if errorlevel 1 (
  echo.
  echo Failed to start workflow.
  pause
  exit /b 1
)

echo.
echo Workflow started successfully.
pause
exit /b 0
