@echo off
title Control & Chaos CMS Launcher
echo ===================================================
echo   Starting Control & Chaos CMS + Local Web Server
echo ===================================================
echo.
echo Launching Decap CMS Backend Proxy...
start "Decap CMS Proxy Server" cmd /k "cd /d %~dp0 && npx decap-server"

echo Launching Static Web Server on http://localhost:3000 ...
start "Control & Chaos Web Server" cmd /k "cd /d %~dp0 && npx serve ."

timeout /t 2 >nul
echo.
echo Opening Admin Panel in your default browser...
start http://localhost:3000/admin/

echo.
echo Done! Both servers are running. Keep the two opened command windows open while editing.
exit
