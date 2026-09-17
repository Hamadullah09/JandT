@echo off
REM What address the handhelds should be pointed at, right now.
REM
REM START.cmd prints this too, but only once, at the moment it runs. The number
REM changes on its own - a different Wi-Fi, a router handing out a new one after
REM a power cut - and when it does, every handheld stops being able to reach the
REM PC while nothing on the PC looks wrong. That is the commonest fault in this
REM system and it always looks like something worse than it is.
REM
REM So: double-click this, read the number, type it into the handheld.

title Clothing Warehouse - server address

echo.
echo   Clothing Warehouse
echo   ==================
echo.
echo   Put this address into the handheld, under Settings:
echo.

set "found="
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4 Address"') do call :show %%A
echo.

if not defined found (
  echo       This PC does not seem to be on a network at all.
  echo       Check the Wi-Fi is connected, then run this again.
  echo.
)

echo   If more than one is listed, use the one that starts the same way as
echo   the handheld's own address. They must be on the same network.
echo.

REM Is it actually running? A correct address is no use if nothing is answering
REM on it, and the two faults look identical from the handheld.
curl -s -o nul --max-time 3 "http://localhost:5080/api/health" >nul 2>&1
if errorlevel 1 (
  echo   The system is NOT running. Double-click START.cmd first.
) else (
  echo   The system is running.
)

echo.
pause
exit /b 0

:show
REM ipconfig writes the address with a leading space, and
REM "http:// 192.168.1.5:5080" is an address somebody will type in exactly as
REM printed. The ~ strips it.
echo       http://%~1:5080
set "found=1"
goto :eof
