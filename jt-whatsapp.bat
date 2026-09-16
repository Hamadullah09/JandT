@echo off
REM ---------------------------------------------------------------------------
REM Start the WhatsApp service that posts new orders into your group.
REM Keep this window open: orders are only sent while it is running. Orders
REM created while it is closed wait in whatsapp\outbox and go out on the
REM next start.
REM
REM   jt-whatsapp               start (first time: link the phone, pick a group)
REM   jt-whatsapp --pick-group  post to a different group
REM   jt-whatsapp --qr          link with a QR code instead of a pairing code
REM
REM After a WhatsApp disconnect the service restarts itself in 10 seconds.
REM Any other stop is final, so a real problem is shown instead of looping.
REM
REM Every path is quoted on purpose: this folder contains an "&", which cmd.exe
REM treats as a command separator when a path reaches it unquoted.
REM ---------------------------------------------------------------------------
setlocal
title JT WhatsApp

set "ROOT=%~dp0"
set "WA=%ROOT%whatsapp"

where node >nul 2>nul
if errorlevel 1 (
    echo   Node.js is not installed or not on PATH.
    exit /b 1
)
if not exist "%WA%\node_modules\baileys\" (
    echo   The WhatsApp service is not installed yet. Install it with:
    echo       cd whatsapp
    echo       npm install
    exit /b 1
)

REM A restart must not ask for the group again, but keeps --qr.
set "ARGS=%*"
set "RESTART_ARGS="
for %%A in (%*) do if /i not "%%~A"=="--pick-group" call set "RESTART_ARGS=%%RESTART_ARGS%% %%~A"
pushd "%WA%"

:run
node "%WA%\service.js" %ARGS%
set "RC=%errorlevel%"
if "%RC%"=="2" (
    set "ARGS=%RESTART_ARGS%"
    echo.
    echo   Restarting in 10 seconds... Ctrl+C to stop.
    timeout /t 10 /nobreak >nul
    goto run
)

popd
exit /b %RC%
