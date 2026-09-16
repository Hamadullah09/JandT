@echo off
REM ---------------------------------------------------------------------------
REM One PDF per item for a day's orders - ready to print and pack.
REM
REM   jt-pack                     pick a day from a list
REM   jt-pack --today             today's orders
REM   jt-pack --date 2026-09-16   a given day
REM
REM Includes every order of that day, from CSV files and from Normal Order.
REM The PDFs go to waybills\packing\<day>\ and the folder opens when done.
REM Parcels with several different products go in "Mixed items".
REM
REM Every path is quoted on purpose: this folder contains an "&", which cmd.exe
REM treats as a command separator when a path reaches it unquoted.
REM ---------------------------------------------------------------------------
setlocal
set "ROOT=%~dp0"
"%ROOT%backend\.venv\Scripts\python.exe" "%ROOT%scripts\pack_orders.py" %*
exit /b %errorlevel%
