# PowerShell script to start a local web server
Write-Host "Starting local web server..." -ForegroundColor Green
Write-Host ""
Write-Host "Open your browser and go to: http://localhost:8000" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host ""

# Try Python first, then fall back to other methods
if (Get-Command python -ErrorAction SilentlyContinue) {
    python -m http.server 8000
} elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
    python3 -m http.server 8000
} else {
    Write-Host "Python not found. Trying Node.js..." -ForegroundColor Yellow
    if (Get-Command node -ErrorAction SilentlyContinue) {
        npx http-server -p 8000
    } else {
        Write-Host "Error: Neither Python nor Node.js found." -ForegroundColor Red
        Write-Host "Please install Python or Node.js to run a local server." -ForegroundColor Red
        pause
    }
}





