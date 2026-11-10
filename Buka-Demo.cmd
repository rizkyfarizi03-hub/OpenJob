@echo off
cd /d "%~dp0openjob_api"
echo OpenJob demo - buka http://127.0.0.1:3100 setelah server siap.
echo Gunakan Ctrl+C untuk menghentikan demo.
node dev/preview.cjs
if errorlevel 1 (
  echo.
  echo Demo belum dapat dijalankan. Pastikan Node.js dan dependency tersedia.
  echo Jalankan npm ci di folder openjob_api lalu coba kembali.
  pause
)
