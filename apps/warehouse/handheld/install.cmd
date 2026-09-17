@echo off
REM Puts the app on a handheld, over USB or over Wi-Fi.
REM
REM Double-click it. It finds the Android tools, builds the APK if it is not
REM there, and installs onto whatever device is connected.

setlocal enabledelayedexpansion
title Warehouse handheld - install

cd /d "%~dp0"

REM ---------------------------------------------------------------- adb

set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
if not exist "%ADB%" set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
if not exist "%ADB%" set "ADB=%ANDROID_SDK_ROOT%\platform-tools\adb.exe"

if not exist "%ADB%" (
  echo.
  echo   adb was not found. It comes with Android Studio, or on its own as
  echo   "SDK Platform Tools" from
  echo     https://developer.android.com/tools/releases/platform-tools
  echo.
  pause
  exit /b 1
)

echo.
echo   Warehouse handheld
echo   ==================
echo.

REM --------------------------------------------------------------- apk

set "APK=app\build\outputs\apk\debug\app-debug.apk"

if not exist "%APK%" (
  echo   Building the app first. The first build takes a few minutes.
  echo.
  call gradlew.bat assembleDebug
  if errorlevel 1 (
    echo.
    echo   The build failed. Nothing was installed.
    echo.
    pause
    exit /b 1
  )
)

REM ------------------------------------------------------------ device

"%ADB%" start-server >nul 2>&1

echo   Looking for a device...
set "FOUND="
for /f "skip=1 tokens=1,2" %%A in ('"%ADB%" devices') do (
  if "%%B"=="device" set "FOUND=%%A"
)

if not defined FOUND (
  echo.
  echo   No device is connected.
  echo.
  echo   Over USB:
  echo     On the handheld, Settings - About - tap Build number seven times,
  echo     then Developer options - USB debugging. Plug it in and accept the
  echo     prompt on the device.
  echo.
  echo   Over Wi-Fi ^(Android 11 and later^):
  echo     Developer options - Wireless debugging - Pair device with pairing code.
  echo     The handheld shows an address, a port and a six-digit code. Then, in
  echo     a command window here:
  echo.
  echo       adb pair 192.168.x.x:PORT
  echo       adb connect 192.168.x.x:PORT2
  echo.
  echo     PORT is the pairing port on the pairing screen; PORT2 is the one on
  echo     the Wireless debugging screen itself. They are different numbers, and
  echo     using the pairing port to connect is the usual reason this fails.
  echo.
  echo   Then run this again.
  echo.
  pause
  exit /b 1
)

echo   Found %FOUND%
echo.
echo   Installing...

"%ADB%" -s %FOUND% install -r "%APK%"
if errorlevel 1 (
  echo.
  echo   The install failed. If it says INSTALL_FAILED_UPDATE_INCOMPATIBLE,
  echo   an older build signed with a different key is on the device:
  echo.
  echo       adb -s %FOUND% uninstall com.warehouse.handheld
  echo.
  pause
  exit /b 1
)

echo.
echo   Installed. Starting it...
"%ADB%" -s %FOUND% shell monkey -p com.warehouse.handheld -c android.intent.category.LAUNCHER 1 >nul 2>&1

echo.
echo   Done. Sign in with a warehouse account.
echo.
echo   If it says it cannot reach the server, check two things: that the PC is
echo   running START.cmd, and that scripts\allow-lan.cmd has been run once as
echo   administrator. Windows Firewall blocks the connection until it has.
echo.
pause
