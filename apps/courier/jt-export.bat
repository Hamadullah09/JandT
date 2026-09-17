@echo off
REM ---------------------------------------------------------------------------
REM All orders in one CSV file for Excel. Click a tracking number in it to open
REM that parcel's tracking page.
REM
REM   jt-export                      every order
REM   jt-export --today              today's orders
REM   jt-export --days 7             the last 7 days (or 30)
REM   jt-export --status DELIVERED   one status: CREATED, PICKED_UP, IN_TRANSIT,
REM                                  ON_DELIVERY, DELIVERED or RETURNED
REM
REM The file is saved in exports\ and opens in Excel. The tracking links open
REM the website, so start it first with jt-portal.
REM
REM Every path is quoted on purpose: this folder contains an "&", which cmd.exe
REM treats as a command separator when a path reaches it unquoted.
REM ---------------------------------------------------------------------------
setlocal
set "ROOT=%~dp0"
"%ROOT%backend\.venv\Scripts\python.exe" "%ROOT%scripts\export_orders.py" %*
exit /b %errorlevel%
