<#
.SYNOPSIS
  Build, package, and optionally install a beta test version of the Obsidian plugin.

.DESCRIPTION
  This script reads plugin metadata from manifest.json, runs the project build,
  stages the release artifacts (main.js, manifest.json, styles.css if present),
  creates a timestamped beta package, and optionally zips it and/or installs it
  into an Obsidian vault plugin directory.

.PARAMETER Zip
  When provided, also creates a .zip archive of the staged beta.

.PARAMETER NoBuild
  Skip running the build (useful if you've already built).

.PARAMETER Suffix
  Pre-release suffix to append to the artifact name. Default: "beta".

.PARAMETER OutputDir
  Output directory (relative to repo root) for staged artifacts and zips.
  Default: "releases/beta".

.PARAMETER Install
  When provided, installs the staged artifacts into the target vault plugin folder.

.PARAMETER VaultPath
  Path to the Obsidian vault root. If provided with -Install, the script will
  install to: <VaultPath>/.obsidian/plugins/<plugin-id>/

.PARAMETER InstallPath
  Explicit path to the destination plugin folder. If provided, this takes precedence
  over -VaultPath.

.EXAMPLE
  ./scripts/create-beta.ps1 -Zip

.EXAMPLE
  ./scripts/create-beta.ps1 -Zip -Install -VaultPath "C:\Users\me\Documents\ObsidianVault"

.EXAMPLE
  ./scripts/create-beta.ps1 -NoBuild -Suffix rc -Zip -Install -InstallPath "D:\Vault\.obsidian\plugins\verse-flow"

.NOTES
  - Requires Node.js and npm in PATH if running the build step.
  - Assumes the build outputs main.js at the repo root alongside manifest.json.
#>

[CmdletBinding()] param(
  [switch]$Zip,
  [switch]$NoBuild,
  [string]$Suffix = 'beta',
  [string]$OutputDir = 'releases/beta',
  [switch]$Install,
  [string]$VaultPath,
  [string]$InstallPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Info($msg)  { Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Write-Warn($msg)  { Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Write-ErrorLine($msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red }

# Resolve repo root (parent of this script folder)
$ScriptDir = $PSScriptRoot
$RepoRoot = Split-Path -Parent $ScriptDir

# Validate required files
$manifestPath = Join-Path $RepoRoot 'manifest.json'
if (-not (Test-Path $manifestPath)) {
  Write-ErrorLine "manifest.json not found at $manifestPath"
  exit 1
}

# Read manifest
try {
  $manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
} catch {
  Write-ErrorLine "Failed to parse manifest.json: $($_.Exception.Message)"
  exit 1
}

$pluginId = $manifest.id
$pluginVersion = $manifest.version
if (-not $pluginId -or -not $pluginVersion) {
  Write-ErrorLine "manifest.json must include 'id' and 'version'"
  exit 1
}

Write-Info "Plugin: $($manifest.name) ($pluginId) v$pluginVersion"

# Build (unless skipped)
if (-not $NoBuild) {
  Write-Info "Running build: npm run build"
  try {
    Push-Location $RepoRoot
    npm run build --silent
  } catch {
    Write-ErrorLine "Build failed: $($_.Exception.Message)"
    Pop-Location -ErrorAction SilentlyContinue
    exit 1
  } finally {
    Pop-Location -ErrorAction SilentlyContinue
  }
} else {
  Write-Info "Skipping build as requested (-NoBuild)."
}

# Verify build artifacts
$mainJs = Join-Path $RepoRoot 'main.js'
if (-not (Test-Path $mainJs)) {
  Write-ErrorLine "Expected build output not found: $mainJs"
  exit 1
}

$stylesCss = Join-Path $RepoRoot 'styles.css'
$hasStyles = Test-Path $stylesCss

# Prepare output staging
$timestamp = Get-Date -Format 'yyyyMMdd-HHmm'
$artifactName = "$pluginId-$pluginVersion-$Suffix.$timestamp"
$resolvedOutputDir = Join-Path $RepoRoot $OutputDir
$stageDir = Join-Path $resolvedOutputDir $artifactName

Write-Info "Staging to: $stageDir"
New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

# Copy artifacts
Copy-Item -Force -Path $mainJs -Destination (Join-Path $stageDir 'main.js')
Copy-Item -Force -Path $manifestPath -Destination (Join-Path $stageDir 'manifest.json')
if ($hasStyles) {
  Copy-Item -Force -Path $stylesCss -Destination (Join-Path $stageDir 'styles.css')
}

# Optionally zip
$zipPath = $null
if ($Zip) {
  $zipPath = Join-Path $resolvedOutputDir ("$artifactName.zip")
  Write-Info "Creating zip: $zipPath"
  if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
  Compress-Archive -Path (Join-Path $stageDir '*') -DestinationPath $zipPath -Force
}

# Optionally install to vault
if ($Install) {
  # Determine install destination
  $destDir = $InstallPath
  if ([string]::IsNullOrWhiteSpace($destDir)) {
    if ([string]::IsNullOrWhiteSpace($VaultPath)) {
      Write-ErrorLine "-Install specified but neither -InstallPath nor -VaultPath provided."
      exit 1
    }
    $destDir = Join-Path (Join-Path $VaultPath '.obsidian\plugins') $pluginId
  }

  Write-Info "Installing to: $destDir"
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null

  Copy-Item -Force -Path (Join-Path $stageDir 'main.js') -Destination (Join-Path $destDir 'main.js')
  Copy-Item -Force -Path (Join-Path $stageDir 'manifest.json') -Destination (Join-Path $destDir 'manifest.json')
  if ($hasStyles) {
    Copy-Item -Force -Path (Join-Path $stageDir 'styles.css') -Destination (Join-Path $destDir 'styles.css')
  }

  Write-Info "Install complete. Reload Obsidian or toggle the plugin to pick up changes."
}

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
Write-Host "Staged folder: $stageDir"
if ($Zip) {
  Write-Host "ZIP:           $zipPath"
}
