# ═══════════════════════════════════════════════════════════════
# RouteAI EDA — One-Line Windows Installer (PowerShell)
# Usage: irm https://raw.githubusercontent.com/Guiimartinho/routeai/main/scripts/install-windows.ps1 | iex
# ═══════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"
$REPO = "Guiimartinho/routeai"

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Blue
Write-Host "  ║    RouteAI EDA — Windows Installer       ║" -ForegroundColor Blue
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Blue
Write-Host ""

# ─── Step 1: Check system ────────────────────────────────────
Write-Host "[1/5] Checking system..." -ForegroundColor Yellow

if ([Environment]::Is64BitOperatingSystem -eq $false) {
    Write-Host "  ERROR: 64-bit Windows required" -ForegroundColor Red
    exit 1
}

$winVer = [System.Environment]::OSVersion.Version
Write-Host "  Windows $($winVer.Major).$($winVer.Minor) (64-bit)"

# ─── Step 2: Download RouteAI installer ──────────────────────
Write-Host ""
Write-Host "[2/5] Downloading RouteAI EDA..." -ForegroundColor Yellow

$releaseUrl = "https://api.github.com/repos/$REPO/releases/latest"
$installerPath = "$env:TEMP\RouteAI-EDA-Setup.exe"

try {
    $release = Invoke-RestMethod -Uri $releaseUrl -ErrorAction Stop
    $exeAsset = $release.assets | Where-Object { $_.name -like "*.exe" } | Select-Object -First 1

    if ($exeAsset) {
        Write-Host "  Downloading $($exeAsset.name) ($([math]::Round($exeAsset.size / 1MB, 1)) MB)..."
        Invoke-WebRequest -Uri $exeAsset.browser_download_url -OutFile $installerPath
        Write-Host "  Downloaded!" -ForegroundColor Green
    } else {
        throw "No .exe found in release"
    }
} catch {
    Write-Host "  No release found. Installing from source..." -ForegroundColor Yellow

    # Fallback: clone and run dev setup
    $installDir = "$env:USERPROFILE\routeai"

    if (Test-Path $installDir) {
        Write-Host "  Updating existing installation..."
        Set-Location $installDir
        git pull
    } else {
        Write-Host "  Cloning repository..."
        git clone "https://github.com/$REPO.git" $installDir
    }

    Write-Host "  Downloaded to $installDir" -ForegroundColor Green
    Write-Host ""
    Write-Host "  To complete setup, open a terminal in $installDir and run:" -ForegroundColor Yellow
    Write-Host "    npm install (in app/ folder)" -ForegroundColor Cyan
    Write-Host "    go build (in packages/api/ folder)" -ForegroundColor Cyan
    Write-Host ""

    $installerPath = $null
}

# ─── Step 3: Run installer ───────────────────────────────────
if ($installerPath -and (Test-Path $installerPath)) {
    Write-Host ""
    Write-Host "[3/5] Running installer..." -ForegroundColor Yellow
    Start-Process -FilePath $installerPath -Wait
    Remove-Item $installerPath -ErrorAction SilentlyContinue
    Write-Host "  RouteAI EDA installed!" -ForegroundColor Green
} else {
    Write-Host "[3/5] Skipping installer (source install)" -ForegroundColor Yellow
}

# ─── Step 4: Install Ollama ──────────────────────────────────
Write-Host ""
Write-Host "[4/5] Setting up Ollama (AI engine)..." -ForegroundColor Yellow

$ollamaInstalled = $false
try {
    $null = Get-Command ollama -ErrorAction Stop
    $ollamaInstalled = $true
    Write-Host "  Ollama already installed" -ForegroundColor Green
} catch {
    Write-Host "  Downloading Ollama..."
    $ollamaUrl = "https://ollama.com/download/OllamaSetup.exe"
    $ollamaPath = "$env:TEMP\OllamaSetup.exe"

    try {
        Invoke-WebRequest -Uri $ollamaUrl -OutFile $ollamaPath
        Write-Host "  Running Ollama installer..."
        Start-Process -FilePath $ollamaPath -Wait
        Remove-Item $ollamaPath -ErrorAction SilentlyContinue

        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

        $ollamaInstalled = $true
        Write-Host "  Ollama installed!" -ForegroundColor Green
    } catch {
        Write-Host "  Failed to install Ollama automatically." -ForegroundColor Yellow
        Write-Host "  Please install manually: https://ollama.com/download" -ForegroundColor Cyan
    }
}

# ─── Step 5: Pull AI model ───────────────────────────────────
Write-Host ""
Write-Host "[5/5] Pulling AI model (qwen2.5:7b, ~5GB)..." -ForegroundColor Yellow

if ($ollamaInstalled) {
    # Make sure Ollama is running
    try {
        $null = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 3 -ErrorAction Stop
    } catch {
        Write-Host "  Starting Ollama service..."
        Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
        Start-Sleep -Seconds 5
    }

    # Check if model already exists
    try {
        $tags = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -ErrorAction Stop
        $hasModel = $tags.models | Where-Object { $_.name -like "qwen2.5:7b*" }
    } catch {
        $hasModel = $null
    }

    if ($hasModel) {
        Write-Host "  Model already downloaded" -ForegroundColor Green
    } else {
        Write-Host "  Downloading model (this may take a few minutes)..."
        & ollama pull qwen2.5:7b
        Write-Host "  Model ready!" -ForegroundColor Green
    }
} else {
    Write-Host "  Skipping (Ollama not installed)" -ForegroundColor Yellow
}

# ─── Done ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║  RouteAI EDA — Installation Complete!    ║" -ForegroundColor Green
Write-Host "  ╠══════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "  ║                                          ║" -ForegroundColor Green
Write-Host "  ║  Launch from Desktop or Start Menu       ║" -ForegroundColor Green
Write-Host "  ║                                          ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
