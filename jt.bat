@echo off
REM ---------------------------------------------------------------------------
REM Interactive runner for the bulk order engine.
REM
REM   jt                 list the CSVs in input\, pick one, validate it, then
REM                      ask before creating the orders and waybills
REM   jt --merge-pdf     any extra flags are passed through to bulk_create.py
REM
REM Every path is quoted on purpose: this folder contains an "&", which cmd.exe
REM treats as a command separator when a path reaches it unquoted.
REM ---------------------------------------------------------------------------
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
set "INDIR=%ROOT%input"
set "PY=%ROOT%backend\.venv\Scripts\python.exe"
set "SCRIPT=%ROOT%scripts\bulk_create.py"
set "OUTDIR=%ROOT%waybills"

if not exist "%PY%" (
    echo Python environment not found at "%PY%".
    echo Create it with:  py -m venv backend\.venv
    exit /b 2
)
if not exist "%INDIR%\" (
    echo No input folder at "%INDIR%".
    exit /b 2
)

REM ---- list the CSVs --------------------------------------------------------
set /a N=0
echo.
echo   CSV files in input\
echo   -------------------
for %%F in ("%INDIR%\*.csv") do (
    set /a N+=1
    set "FILE[!N!]=%%~fF"
    echo     [!N!] %%~nxF
)

if !N!==0 (
    echo     none found - put a CSV in "%INDIR%" first.
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
if not exist "!CSV!" (
    echo   File has gone missing: "!CSV!"
    exit /b 2
)

REM ---- validate -------------------------------------------------------------
echo.
echo   Validating...
echo.
"%PY%" "%SCRIPT%" --csv "!CSV!" --out "%OUTDIR%" --dry-run %* <nul
set "RC=!errorlevel!"

if !RC! geq 2 (
    echo.
    echo   Could not read the file - nothing was created.
    exit /b 2
)
if !RC! equ 1 (
    echo.
    echo   Some rows are invalid. Continuing creates only the valid ones.
)

REM ---- confirm, then create -------------------------------------------------
echo.
set "GO="
set /p "GO=  Create orders and waybills? [y/N]: "
if /i not "!GO!"=="y" (
    echo   Cancelled - nothing was created.
    exit /b 0
)
echo.
"%PY%" "%SCRIPT%" --csv "!CSV!" --out "%OUTDIR%" %* <nul
exit /b !errorlevel!
