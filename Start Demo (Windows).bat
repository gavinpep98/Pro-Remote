@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js isnt installed. Get the LTS version from https://nodejs.org then run this again. & pause & exit /b 1)
node demo\start-demo.js
pause
