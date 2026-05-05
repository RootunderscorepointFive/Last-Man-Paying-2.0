@echo off
echo Syncing FPL Data...
node sync_fpl.js
if %ERRORLEVEL% NEQ 0 (
    echo Error during sync!
    pause
    exit /b %ERRORLEVEL%
)
echo Staging changes...
git add fpl_data.json
echo Committing...
git commit -m "Auto-update FPL data"
echo Pushing to GitHub...
git push origin main
echo Done! Website is updating.
pause
