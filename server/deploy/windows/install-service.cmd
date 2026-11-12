@echo off
rem Trai Ga - install-service (nhap dup de chay)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-service.ps1" %*
pause
