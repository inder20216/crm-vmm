@echo off
echo Starting VMM Follow-up Portal...
echo.
echo Page will open at: http://localhost:3030
echo Press Ctrl+C in this window to stop the server.
echo.
start "" "http://localhost:3030"
npx --yes serve . -l 3030
pause
