@echo off
setlocal
cd /d "%~dp0"
echo.
echo KUYKENDALL INDUSTRIES / METADATA 0.4.0
where node >nul 2>nul
if errorlevel 1 goto missingnode
if not exist node_modules\electron\dist\electron.exe (
  echo Installing desktop build dependencies. This requires internet access.
  call npm ci
  if errorlevel 1 goto failed
)
if exist native\target\release\ki-meta.exe goto buildui
where cargo >nul 2>nul
if errorlevel 1 goto missingrust
call npm run build:core
if errorlevel 1 goto failed
:buildui
call npm run build:ui
if errorlevel 1 goto failed
call npm start
if errorlevel 1 goto failed
exit /b 0
:missingnode
echo Node.js 22 or newer is required for source launch. Employees can use the EXE download.
goto failed
:missingrust
echo The included Windows native engine is missing. Re-extract the complete source archive,
echo or install Rust stable MSVC and C++ Build Tools to rebuild it. See README.md.
goto failed
:failed
echo.
echo Launch stopped. Review the error above.
pause
exit /b 1
