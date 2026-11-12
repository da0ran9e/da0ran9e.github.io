@echo off
rem Trai Ga - check (nhap dup de chay)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check.ps1" %*
pause
