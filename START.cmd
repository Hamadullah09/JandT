@echo off
REM Starts the Inaaya Commerce Platform: database, warehouse, courier portal and
REM gateway, in Docker. Opens the browser when everything is healthy.
REM
REM The first start builds the images and takes several minutes. After that it
REM takes seconds. Data lives in Docker volumes and survives STOP.cmd.
title Inaaya Commerce Platform
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\platform.ps1" start
echo.
pause
