#Requires -Version 5.1
<#
.SYNOPSIS
  Helper: download a file over HTTPS and verify its SHA-256 digest before
  keeping it. Used by download-dependencies.bat. Fails closed: on a digest
  mismatch, or when no digest was supplied to check against, the downloaded
  file is deleted and the script exits non-zero.

.PARAMETER Url
  Absolute https:// URL to download.

.PARAMETER OutFile
  Destination path for the downloaded file.

.PARAMETER Sha256
  Expected lowercase hex SHA-256 digest. If blank, the script downloads,
  prints the digest it computed, and exits 2 (verify-only mode) rather than
  trusting an unverified file -- this is how a maintainer obtains the real
  digest to record in vendor/dependencies.json.
#>
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$Sha256 = ""
)

$ErrorActionPreference = "Stop"

if ($Url -notmatch '^https://') {
  Write-Error "Refusing non-HTTPS URL: $Url"
  exit 1
}

$outDir = Split-Path -Parent $OutFile
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

Write-Host "Downloading: $Url"
try {
  Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
} catch {
  Write-Error "Download failed: $($_.Exception.Message)"
  exit 1
}

$actual = (Get-FileHash -LiteralPath $OutFile -Algorithm SHA256).Hash.ToLowerInvariant()

if ([string]::IsNullOrWhiteSpace($Sha256)) {
  Write-Host "No expected digest supplied. Computed SHA-256: $actual"
  Write-Host "Record this value in vendor/dependencies.json before this file is trusted."
  exit 2
}

$expected = $Sha256.ToLowerInvariant()
if ($actual -ne $expected) {
  Write-Error "SHA-256 mismatch for $OutFile`n  expected: $expected`n  actual:   $actual"
  Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
  exit 1
}

Write-Host "SHA-256 verified: $actual"
exit 0
