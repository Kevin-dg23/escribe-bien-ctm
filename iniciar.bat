@echo off
title Escribe Bien CTM
cd /d "%~dp0"
echo ===================================================
echo           Iniciando Escribe Bien CTM...
echo ===================================================
echo Abriendo la aplicacion en http://localhost:3000
start http://localhost:3000
npm run dev
pause
