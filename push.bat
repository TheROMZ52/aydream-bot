@echo off
setlocal
cd /d "%~dp0"
set "MESSAGE=%~1"
if "%MESSAGE%"=="" set "MESSAGE=Update Aydream"
echo Saving local Aydream files to GitHub...
git add -A
if errorlevel 1 goto :error
git diff --cached --quiet
if not errorlevel 1 (
  echo No changes to push.
  pause
  exit /b 0
)
git commit -m "%MESSAGE%"
if errorlevel 1 goto :error
git push origin main
if errorlevel 1 goto :error
echo.
echo Push completed.
pause
exit /b 0
:error
echo.
echo Push failed. Check the message above.
pause
exit /b 1
