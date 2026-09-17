@echo off
REM ---------------------------------------------------------------------------
REM Start the website and open the login page.
REM
REM   jt-portal
REM
REM Two windows open, "JT API" and "JT Website". Keep them open while you use
REM the website; close them to stop it. Running jt-portal again while they are
REM open just opens the browser.
REM
REM   Login           http://localhost:3000/login
REM   Admin portal    http://localhost:3000/admin
REM   Normal Order    http://localhost:3000/order/normal
REM   Tracking page   http://localhost:3000/tracking
REM
REM Every path is quoted on purpose: this folder contains an "&", which cmd.exe
REM treats as a command separator when a path reaches it unquoted.
REM ---------------------------------------------------------------------------
setlocal
set "ROOT=%~dp0"

if not exist "%ROOT%backend\.venv\Scripts\python.exe" (
    echo   The API is not installed yet: backend\.venv is missing.
    exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
    echo   Node.js is not installed or not on PATH.
    exit /b 1
)
if not exist "%ROOT%frontend\node_modules\next\" (
    echo   The website is not installed yet. Install it with:
    echo       cd frontend
    echo       npm install
    exit /b 1
)

netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul
if errorlevel 1 (
    start "JT API" /D "%ROOT%backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
) else (
    echo   The API is already running.
)

netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul
if errorlevel 1 (
    start "JT Website" /D "%ROOT%frontend" cmd /k "node node_modules\next\dist\bin\next dev -p 3000"
) else (
    echo   The website is already running.
)

echo   Starting - the login page opens in your browser when it is ready...
powershell -NoProfile -Command "for ($i = 0; $i -lt 60; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 'http://localhost:3000/login' | Out-Null; exit 0 } catch { Start-Sleep -Seconds 2 } }; exit 1"
if errorlevel 1 (
    echo   The website did not answer. Check the "JT Website" window for errors.
    exit /b 1
)
start "" "http://localhost:3000/login"
exit /b 0
