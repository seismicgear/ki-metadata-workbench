@echo off
setlocal
cd /d "%~dp0"
call npm run build
if errorlevel 1 goto failed
call npm test
if errorlevel 1 goto failed
echo Automated checks passed. Run npm run test:desktop separately. Windows acceptance still needs testing.
pause
exit /b 0
:failed
echo Verification failed. Review the output above.
pause
exit /b 1
