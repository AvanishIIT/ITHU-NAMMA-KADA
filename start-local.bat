@echo off
start "" cmd /k "cd /d \"%~dp0\" && npm start"
timeout /t 4 /nobreak >nul
start "" http://localhost:3000/seller.html
