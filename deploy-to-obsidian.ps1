# deploy-to-obsidian.ps1
# Copia los archivos del repo de desarrollo al plugin de Obsidian.
# NO sobrescribe data.json ni ai-cache.json (archivos runtime).
#
# Uso:
#   .\deploy-to-obsidian.ps1              # deploy normal
#   .\deploy-to-obsidian.ps1 -Restart     # deploy + reiniciar Obsidian

param(
    [switch]$Restart
)

$ErrorActionPreference = "Stop"

$source = $PSScriptRoot
$dest = Join-Path $env:USERPROFILE "Desktop\Mi Boveda\.obsidian\plugins\better-local-graph"

if (-not (Test-Path $dest)) {
    Write-Host "ERROR: No se encontro la carpeta del plugin: $dest" -ForegroundColor Red
    exit 1
}

Write-Host "Deploy: $source -> $dest" -ForegroundColor Cyan

# Archivos a copiar
$files = @(
    "main.js",
    "manifest.json",
    "styles.css",
    "versions.json",
    "blg-backgrounds.js",
    "blg-mcp-server.js",
    "blg-tag-mindmap.js",
    "blg-vendor-markmap.js"
)

foreach ($f in $files) {
    $src = Join-Path $source $f
    if (Test-Path $src) {
        Copy-Item $src $dest -Force
        Write-Host "  OK  $f" -ForegroundColor Green
    } else {
        Write-Host "  SKIP $f (no existe)" -ForegroundColor Yellow
    }
}

# Copiar carpeta backgrounds/ (snippets de fondos animados)
$bgSrc = Join-Path $source "backgrounds"
$bgDest = Join-Path $dest "backgrounds"
if (Test-Path $bgSrc) {
    if (-not (Test-Path $bgDest)) { New-Item -ItemType Directory -Path $bgDest -Force | Out-Null }
    Copy-Item "$bgSrc\*" $bgDest -Force -Recurse
    Write-Host "  OK  backgrounds/" -ForegroundColor Green
}

# NO copiar: data.json, ai-cache.json, .git/, .gitignore, README*, AGENT*, LICENSE, .opencode/

Write-Host "`nDeploy completado." -ForegroundColor Cyan

if ($Restart) {
    Write-Host "Reiniciando Obsidian..." -ForegroundColor Yellow
    Get-Process "Obsidian" -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    $obsidianPath = Join-Path $env:LOCALAPPDATA "Obsidian\Obsidian.exe"
    if (Test-Path $obsidianPath) {
        Start-Process $obsidianPath
        Write-Host "Obsidian reiniciado." -ForegroundColor Green
    } else {
        Write-Host "No se encontro Obsidian.exe en $obsidianPath" -ForegroundColor Yellow
    }
}
