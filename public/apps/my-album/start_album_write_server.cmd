@echo off
rem Dich vu ghi cua My Album (them anh / chuyen anh vao _Thung_rac).
rem Sua ALBUM_ROOT neu thu muc goc dang chia se khong phai E:\Pictures.
set ALBUM_ROOT=E:\Pictures
cd /d "%~dp0"
py album_write_server.py --root "%ALBUM_ROOT%" --port 8010
pause
