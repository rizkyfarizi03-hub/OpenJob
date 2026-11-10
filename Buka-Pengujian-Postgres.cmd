@echo off
cd /d "%~dp0openjob_api"
echo OpenJob pengujian: http://127.0.0.1:3101
echo Data tersimpan di PostgreSQL Docker QA. Email masuk Mailpit lokal 8025.
echo Pastikan Docker dan layanan lokal menyala. Ctrl+C untuk berhenti.
node dev/preview-postgres.cjs
if errorlevel 1 pause
