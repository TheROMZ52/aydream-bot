@echo off
setlocal
cd /d "%~dp0"

echo Aydream GitHub Actions Workflows
echo ==============================
echo.
gh workflow list --repo TheROMZ52/aydream-bot
if errorlevel 1 (
  echo.
  echo Failed to load workflows.
  echo Make sure GitHub CLI is installed and authenticated.
  pause
  exit /b 1
)

echo.
set /p "WORKFLOW=Enter workflow name or file to run: "
if "%WORKFLOW%"=="" (
  echo No workflow selected.
  pause
  exit /b 1
)

echo.
echo Starting workflow: %WORKFLOW%
gh workflow run "%WORKFLOW%" --repo TheROMZ52/aydream-bot --ref main
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
