@echo off
REM ---------------------------------------------------------------------------
REM Post existing orders to the WhatsApp group.
REM
REM   jt-send --order-no 12809
REM   jt-send --order-no 12809 --image "#1 (5).jpeg"
REM   jt-send --from-csv input\customers_10.csv
REM
REM New orders are posted automatically. Use this for orders made before
REM WhatsApp was switched on, to post one again, or to test the group on a real
REM order without creating a new one. It asks before queueing anything, and
REM jt-whatsapp must be running for the messages to actually go out.
REM
REM Every path is quoted on purpose: this folder contains an "&", which cmd.exe
REM treats as a command separator when a path reaches it unquoted.
REM ---------------------------------------------------------------------------
setlocal
set "ROOT=%~dp0"
set "PY=%ROOT%backend\.venv\Scripts\python.exe"

if "%~1"=="" (
    "%PY%" "%ROOT%scripts\whatsapp_send.py" --help
    exit /b 2
)
"%PY%" "%ROOT%scripts\whatsapp_send.py" %*
exit /b %errorlevel%
