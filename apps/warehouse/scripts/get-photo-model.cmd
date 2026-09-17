@echo off
REM Downloads the recognition model that search by photo needs, into
REM server\Warehouse.Api\models\dinov2-small.onnx, and checks it arrived whole.
REM
REM   The file: Meta's DINOv2 (small), converted for ONNX by Xenova, from
REM   https://huggingface.co/Xenova/dinov2-small  - Apache-2.0 licence, 84 MB.
REM
REM Only needed once per machine. Without it everything else works and search
REM by photo says it is not set up.

setlocal
set "DEST=%~dp0..\server\Warehouse.Api\models"
set "FILE=%DEST%\dinov2-small.onnx"
set "URL=https://huggingface.co/Xenova/dinov2-small/resolve/main/onnx/model.onnx"
set "SHA256=83141175ec78b4ff9a2bb58a4c7c264ba0054d1c2e122e5a8114b79a8d4179ea"

if not exist "%DEST%" mkdir "%DEST%"

if exist "%FILE%" (
  echo   The model is already there: %FILE%
  goto verify
)

echo   Downloading the search-by-photo model (84 MB)...
curl.exe -L --fail -o "%FILE%.part" "%URL%"
if errorlevel 1 (
  echo.
  echo   The download failed. Check the internet connection and run this again.
  del "%FILE%.part" >nul 2>&1
  exit /b 1
)
move /y "%FILE%.part" "%FILE%" >nul

:verify
set "GOT="
for /f "delims=" %%H in ('powershell -NoProfile -Command "(Get-FileHash -Algorithm SHA256 -LiteralPath '%FILE%').Hash"') do set "GOT=%%H"
if /i not "%GOT%"=="%SHA256%" (
  echo.
  echo   The model file is damaged or not the expected one. Delete it and run this again:
  echo     %FILE%
  exit /b 1
)
echo   The model is ready. Restart the application to switch search by photo on.
exit /b 0
