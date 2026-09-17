@echo off
REM Stops the Inaaya Commerce Platform. Nothing is deleted: START.cmd brings it
REM back exactly as it was.
title Inaaya Commerce Platform - stopping
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\platform.ps1" stop
echo.
pause
