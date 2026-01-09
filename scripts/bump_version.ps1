[CmdletBinding()]
param(
  [string]$Prerelease = 'beta'
)

$PSNativeCommandUseErrorActionPreference = $true
Set-StrictMode -Off
$ErrorActionPreference = 'Stop'

function Write-Info($m) { Write-Host "[INFO]  $m" -ForegroundColor Cyan }
function Write-Err($m) { Write-Host "[ERROR] $m" -ForegroundColor Red }

# Resolve external tools explicitly
$git = (Get-Command git -ErrorAction Stop).Source
$npmCmd = (Get-Command npm -ErrorAction Stop).Source
# On Windows, prefer npm.cmd wrapper if available next to npm script
try {
  $npmDir = Split-Path -Parent $npmCmd
  $npmCmdPath = Join-Path $npmDir 'npm.cmd'
  if ($IsWindows -or $env:OS -like '*Windows*') {
    if (Test-Path $npmCmdPath) { $npmCmd = $npmCmdPath }
  }
} catch {}
Write-Info "Using npm at: $npmCmd"

# Read current version from package.json
if (-not (Test-Path 'package.json')) { Write-Err 'package.json not found'; exit 1 }
$pkg = Get-Content -Raw package.json | ConvertFrom-Json
$cur = [string]$pkg.version
if (-not $cur) { Write-Err 'Could not read version from package.json'; exit 1 }

# Parse semver and compute next prerelease
$m = [regex]::Match($cur, '^(\d+)\.(\d+)\.(\d+)(?:-([A-Za-z0-9]+)\.(\d+))?$')
if (-not $m.Success) { Write-Err "Unsupported version format: $cur"; exit 1 }
$maj = [int]$m.Groups[1].Value
$min = [int]$m.Groups[2].Value
$pat = [int]$m.Groups[3].Value
$preName = $m.Groups[4].Value
$preNum = if ($m.Groups[5].Success) { [int]$m.Groups[5].Value } else { 0 }

if ($preName -and ($preName -ieq $Prerelease)) {
  $next = $preNum + 1
  $newVersion = "$maj.$min.$pat-$Prerelease.$next"
} else {
  # If currently not a matching prerelease, start at .1
  $newVersion = "$maj.$min.$pat-$Prerelease.1"
}

# Ensure we don't reuse an existing tag; bump until unique
function Test-TagExists($tag) {
  $local = & $git 'tag' '--list' $tag
  if ($local) { return $true }
  $remote = & $git 'ls-remote' '--tags' 'origin' "refs/tags/$tag" 2>$null
  return [bool]$remote
}

while (Test-TagExists ("$Prerelease-$newVersion")) {
  $m2 = [regex]::Match($newVersion, '^(\d+)\.(\d+)\.(\d+)-([A-Za-z0-9]+)\.(\d+)$')
  $nextNum = ([int]$m2.Groups[5].Value) + 1
  $newVersion = "$($m2.Groups[1].Value).$($m2.Groups[2].Value).$($m2.Groups[3].Value)-$($m2.Groups[4].Value).$nextNum"
}

Write-Info "Current version: $cur"
Write-Info "Next version:    $newVersion"

# Bump package.json; npm lifecycle 'version' runs version-bump.mjs to sync manifest/versions
try {
  if ($IsWindows -or $env:OS -like '*Windows*') {
    & cmd.exe '/c' "npm version $newVersion --no-git-tag-version"
  } else {
    & $npmCmd 'version' $newVersion '--no-git-tag-version'
  }
} catch {
  Write-Err "npm invocation failed. $_"
  throw
}

# Commit bumped files (ignore if nothing to commit)
& $git 'add' 'package.json' 'manifest.json' 'versions.json'
& $git 'commit' '-m' "chore: bump to $newVersion" 2>$null | Out-Null
& $git 'push'

# Create beta tag to trigger GitHub Action release
$tag = "$Prerelease-$newVersion"
Write-Info "Tagging and pushing: $tag"
& $git 'tag' $tag
& $git 'push' 'origin' $tag

Write-Host "Done." -ForegroundColor Green