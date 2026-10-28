@echo off
rem Starts Eddy (after setup) on http://localhost:8080
cd /d "%~dp0\..\.."
title Eddy server
npm start
