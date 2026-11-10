@echo off
cd /d "%~dp0openjob_api"
echo Demo OpenJob dengan email reset dan verifikasi ke Mailpit lokal.
echo Pastikan Mailpit berjalan di port 1025 dan 8025.
echo Website: http://127.0.0.1:3100 - Inbox: http://127.0.0.1:8025
echo Jangan jalankan bersamaan dengan Buka-Demo.cmd pada port yang sama.
node dev/preview-mail.cjs
if errorlevel 1 pause

