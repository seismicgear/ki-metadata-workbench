@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (
  call npm ci
  if errorlevel 1 goto failed
)
call npm run build
if errorlevel 1 goto failed
call npm test
if errorlevel 1 goto failed
call npm run dist:win
if errorlevel 1 goto failed
echo.
echo Installer generated in release\. This build is unsigned unless you configure signing.
echo Run docs\WINDOWS_ACCEPTANCE.md before distributing it through Array.
pause
exit /b 0
:failed
echo Build or qualification failed. No release is being declared ready.
pause
exit /b 1
