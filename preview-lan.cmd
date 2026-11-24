@echo off
setlocal
cd /d "%~dp0"

set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

echo ==========================================================
echo  Jinyao preview - LAN mode (phone can open it)
echo ----------------------------------------------------------
echo  1. If Windows Firewall asks, click "Allow access"
echo  2. Phone must be on the SAME WiFi as this PC
echo  3. Open on phone:  http://YOUR-PC-IP:4174
echo     Find your IP: ipconfig  ^(WLAN IPv4^)
echo  4. Ctrl+C here to stop
echo ==========================================================
echo.

"%NODE%" scripts\preview.js 4174 0.0.0.0

echo.
echo Server stopped.
pause
