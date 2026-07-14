@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 "%~dp0extract_album_metadata.py" --no-pause %*
) else (
  python "%~dp0extract_album_metadata.py" --no-pause %*
)

set "exit_code=%errorlevel%"
echo.
if not "%exit_code%"=="0" echo Script finished with exit code %exit_code%.
pause
exit /b %exit_code%
