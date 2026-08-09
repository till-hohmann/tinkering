# deploy.ps1 — deploy the app to Cloudflare Pages.
#
# Ships the PUBLIC build by default: the app, and nothing personal. No endpoint,
# no token, no personal routine, no training blocks, no logged history. That is
# what lets ONE deployment serve several people — each install holds its own
# backup endpoint + token in Settings, on its own device, and pulls its own data.
#
# Set NINEFOLD_BAKE_OVERLAY=1 to bake a private overlay in instead. See the
# overlay section below for what that ships and why it is no longer the default.
#
# NEVER deployed either way: full backups / exported logs
# (fitness-backup*.json, fitness-log*.md).
#
#   pwsh tools/deploy.ps1
#
# Remember to bump CACHE in sw.js (and APP_VERSION in js/version.js) before
# deploying so devices pick up changes.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$stage = Join-Path $root ".deploy"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path (Join-Path $stage "data") | Out-Null

Copy-Item index.html, manifest.webmanifest, sw.js $stage
Copy-Item -Recurse css, js, icons, audio, fonts $stage
# Exercise renders: the webps + manifest ship, the PNG MASTERS do not. They are
# ~1.9 MB each (129 MB for the set), the app never requests one, and uploading
# them would multiply the deploy by twenty-five to deliver nothing.
if (Test-Path img) {
  Copy-Item -Recurse img $stage
  Get-ChildItem (Join-Path $stage "img") -Recurse -Filter *.png -ErrorAction SilentlyContinue | Remove-Item -Force
}
# --- private overlay: OFF by default ---------------------------------------
#
# Baking a personal install into the deployment is now OPT-IN, because a
# deployment is a public web address and everything staged here is served to
# anyone who has it. Four things used to be baked in:
#
#   config.js            your Worker endpoint AND its token — readable by anyone
#                        who fetches the JS, which is what forced a rotation once
#   mobility-program.js  a routine written around one person's injuries
#   overlay/data/*.json  your training blocks, seeded into any install on first run
#   seed-sessions.json   your entire logged history, likewise
#
# None of that is safe on an address more than one person uses, and the app no
# longer needs any of it: the endpoint and token belong in Settings (device-local,
# never synced, never in the JS), the routine is a synced pref, and programs and
# sessions come back from the cloud backup. So the default deploy is now the
# PUBLIC build, which one URL can serve to several people who each keep their own
# backup.
#
# Set NINEFOLD_BAKE_OVERLAY=1 for the old single-user behaviour. It is convenient
# for a private URL nobody else opens — a wiped device recovers with no input,
# because the credential is already in the build — and that convenience is exactly
# the exposure, so it should be a decision, not a default.
$bake = $env:NINEFOLD_BAKE_OVERLAY -eq "1"

if ($bake) {
  # Program plans. The PUBLIC repo ships none — a fresh install has no program and
  # the in-app builder writes the first one.
  if (Test-Path overlay/data) {
    Get-ChildItem overlay/data -Filter *.json | ForEach-Object { Copy-Item $_.FullName (Join-Path $stage "data") }
  }
  if (Test-Path data/seed-sessions.json) {                                      # history auto-restore net
    Copy-Item data/seed-sessions.json (Join-Path $stage "data")
  }
  # Each entry is  overlay-file -> the staged public file it replaces.
  $overlayMap = @{
    "config.js"           = "js/config.js"
    "mobility-program.js" = "js/mobility-program.js"
  }
  $applied = @()
  foreach ($src in $overlayMap.Keys) {
    $from = Join-Path $root "overlay/$src"
    if (Test-Path $from) {
      Copy-Item $from (Join-Path $stage $overlayMap[$src]) -Force
      $applied += $src
    }
  }
  if ($applied.Count) { Write-Host "BAKED private overlay: $($applied -join ', ') - this URL is now single-user." }
  else { Write-Host "NINEFOLD_BAKE_OVERLAY set but no overlay/ found - deploying the PUBLIC build." }
} else {
  Write-Host "Deploying the PUBLIC build: no credentials, no personal routine, no programs, no history."
  Write-Host "  Each install sets its own backup under Settings -> Data & backup -> Cloud backup."
}

# safety: refuse to deploy full backups / exported logs (those stay off the URL)
$leak = Get-ChildItem -Recurse $stage -Include "fitness-backup*.json", "fitness-log*.md"
if ($leak) { throw "Refusing to deploy: backup/export data in staging: $($leak.FullName)" }

# safety: the staged config must parse and must not be a half-applied overlay
$staged = Get-Content (Join-Path $stage "js/config.js") -Raw
if ($staged -notmatch "BUILD_CONFIG") { throw "Refusing to deploy: staged js/config.js looks wrong." }

# safety: a NON-baked deploy must carry nothing personal. This is the guard that
# makes a shared URL safe to keep using — the failure mode it exists for is a
# future edit quietly re-adding an overlay copy and nobody noticing until someone
# else's install has your token in it.
if (-not $bake) {
  if ($staged -notmatch 'endpoint:\s*null' -or $staged -notmatch 'token:\s*null') {
    throw "Refusing to deploy: staged js/config.js carries an endpoint or token, but this is a public build."
  }
  if ($staged -match 'legacyDefaults:\s*\{') {
    throw "Refusing to deploy: staged js/config.js carries legacyDefaults, but this is a public build."
  }
  $personal = Get-ChildItem -Recurse (Join-Path $stage "data") -Filter *.json -ErrorAction SilentlyContinue
  if ($personal) { throw "Refusing to deploy: personal program/session data in staging: $($personal.Name -join ', ')" }
}

# Deploy. Set NINEFOLD_PROJECT to your own Cloudflare Pages project name.
#
# On Windows, invoke the .cmd shim rather than the extensionless shell script:
# the latter fails SILENTLY under PowerShell (a native failure does not trip
# ErrorActionPreference=Stop), printing "Deployed" without having uploaded
# anything. Auth lives in your global wrangler config, not in node_modules.
$project = if ($env:NINEFOLD_PROJECT) { $env:NINEFOLD_PROJECT } else { "ninefold" }
$wrangler = Join-Path $root "node_modules\.bin\wrangler.cmd"
if (Test-Path $wrangler) {
  & $wrangler pages deploy $stage --project-name $project --branch main --commit-dirty=true
} else {
  & npx --yes "wrangler@4" pages deploy $stage --project-name $project --branch main --commit-dirty=true
}
$code = $LASTEXITCODE

Remove-Item -Recurse -Force $stage
if ($code -ne 0) { throw "wrangler deploy failed (exit $code) - NOT deployed." }

# --- verify what the PRODUCTION url actually serves -------------------------
# Cloudflare's edge keeps serving the previous build for a while, and a single
# cache-busted request can come back stale in EITHER direction - reporting an old
# version that has in fact deployed, or (worse) a value that makes a broken deploy
# look fine. Three agreeing reads is the cheap way to stop guessing; this check
# read stale three separate times in one afternoon before it was automated.
$expected = (Select-String -Path (Join-Path $root "js/version.js") -Pattern 'APP_VERSION = "([^"]+)"').Matches[0].Groups[1].Value
# Set NINEFOLD_URL to your production URL to have this verified automatically.
# No default is hardcoded: a deployment hostname identifies a specific person's
# site, and this file ships publicly.
$prodUrl = $env:NINEFOLD_URL
if (-not $prodUrl) {
  Write-Host "Deployed $expected. Set NINEFOLD_URL to have this script confirm what production actually serves."
  return
}
Write-Host "Verifying $prodUrl serves $expected ..."
$agree = 0
foreach ($i in 1..8) {
  Start-Sleep -Seconds 2
  try {
    $bust = [Guid]::NewGuid().ToString("N")
    $js = (Invoke-WebRequest -Uri "$prodUrl/js/version.js?cb=$bust" -UseBasicParsing -TimeoutSec 15).Content
    if ($js -match [Regex]::Escape($expected)) { $agree++ } else { $agree = 0 }
  } catch { $agree = 0 }
  if ($agree -ge 3) { break }
}
if ($agree -ge 3) { Write-Host "Verified: $prodUrl is serving $expected." }
else { Write-Warning "Deployed, but $prodUrl did not consistently report $expected. Re-check with a cache-buster before trusting it." }
