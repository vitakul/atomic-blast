@echo off
rem Spusti herni server Atomic Blast pro hru po Wi-Fi (Windows: staci dvojklik).
cd /d "%~dp0server"
where node >nul 2>nul
if errorlevel 1 (
  echo Chybi Node.js. Nainstaluj ho z https://nodejs.org ^(verze 18 nebo novejsi^) a spust znovu.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Prvni spusteni - instaluji zavislosti...
  call npm install --omit=dev
)
node index.js
pause
