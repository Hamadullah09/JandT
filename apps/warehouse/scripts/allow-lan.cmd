@echo off
REM Lets the handhelds reach this PC.
REM
REM Windows Firewall blocks incoming connections by default, so the application
REM can be running, bound to every interface and perfectly healthy, and a
REM handheld on the same Wi-Fi will still say it cannot reach the server. This
REM is the one thing that fixes it, and it is separate from START.cmd because
REM it needs administrator rights and only has to be done once.
REM
REM RIGHT-CLICK THIS FILE AND CHOOSE "RUN AS ADMINISTRATOR".

title Clothing Warehouse - allow handhelds in

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   This has to run as administrator.
  echo   Right-click allow-lan.cmd and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)

echo.
echo   Opening port 5080 for handhelds on the local network...
echo.

REM Removed first so running this twice does not leave two rules behind.
netsh advfirewall firewall delete rule name="Clothing Warehouse (handhelds)" >nul 2>&1

netsh advfirewall firewall add rule ^
  name="Clothing Warehouse (handhelds)" ^
  dir=in action=allow protocol=TCP localport=5080 ^
  profile=private,domain

if errorlevel 1 (
  echo.
  echo   That did not work. The rule was not added.
  echo.
  pause
  exit /b 1
)

echo.
echo   Done. Handhelds on this network can now reach the warehouse.
echo.
echo   Private and domain networks only - deliberately. If this PC is ever on
echo   a public Wi-Fi, the warehouse must not be reachable from it.
echo.
echo   The address to put in a handheld:
echo.
REM Through :showip rather than echoed straight out: ipconfig writes the
REM address with a leading space, and an address printed as "http:// 1.2.3.4"
REM is an address somebody types in exactly as printed.
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4 Address"') do call :showip %%A
echo.
pause
exit /b 0

:showip
echo       http://%~1:5080
goto :eof
