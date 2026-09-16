@echo off
REM ---------------------------------------------------------------------------
REM Delete the orders a CSV created, so the same CSV can be run again.
REM
REM   jt-delete          list the CSVs in input\, pick one, review the matching
REM                      orders, then confirm before anything is deleted
REM
REM Deleting PDFs from waybills\ does NOT free an order number - the duplicate
REM guard lives in the database. This is how you release one.
REM
REM Every path is quoted on purpose: this folder contains an "&", which cmd.exe
REM treats as a command separator when a path reaches it unquoted.
REM ---------------------------------------------------------------------------
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
set "INDIR=%ROOT%input"
set "PY=%ROOT%backend\.venv\Scripts\python.exe"
set "SCRIPT=%ROOT%scripts\delete_orders.py"

if not exist "%PY%" (
    echo Python environment not found at "%PY%".
    exit /b 2
)
if not exist "%INDIR%\" (
    echo No input folder at "%INDIR%".
    exit /b 2
)

REM ---- list the CSVs --------------------------------------------------------
set /a N=0
echo.
echo   Delete the orders created from which CSV?
echo   -----------------------------------------
for %%F in ("%INDIR%\*.csv") do (
    set /a N+=1
    set "FILE[!N!]=%%~fF"
    echo     [!N!] %%~nxF
)

if !N!==0 (
    echo     none found in "%INDIR%".
    exit /b 2
)
echo.

REM ---- pick one -------------------------------------------------------------
set "PICK="
set /p "PICK=  Select 1-!N! (or Enter to cancel): "
if not defined PICK (
    echo   Cancelled.
    exit /b 0
)

REM reject anything that is not a plain number before using it as an index
for /f "delims=0123456789" %%X in ("!PICK!") do (
    echo   "!PICK!" is not a number.
    exit /b 2
)

set "CSV=!FILE[%PICK%]!"
if not defined CSV (
    echo   "%PICK%" is not one of 1-!N!.
    exit /b 2
)

REM ---- show matches and confirm (the Python script asks before deleting) -----
"%PY%" "%SCRIPT%" --from-csv "!CSV!"
exit /b !errorlevel!
