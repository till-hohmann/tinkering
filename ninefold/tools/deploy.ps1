# deploy.ps1 — deploy the app to Cloudflare Pages (project: fitness-tracker).
#
# Ships the app + the program plans + data/seed-sessions.json. The seed file is
# deployed ON PURPOSE: it is the auto-restore safety net, so if on-device storage
# is ever cleared (e.g. the home-screen app is removed/re-added) the history
# repopulates on next launch. Seeding is non-destructive (store.js only fills
# missing sessions, never overwrites local data). It sits on the unguessable
# *.pages.dev URL and contains only training logs (no credentials).
# Still NEVER deployed: full backups / exported logs (fitness-backup*.json, fitness-log*.md).
#
#   pwsh tools/deploy.ps1
#
# Remember to bump CACHE in sw.js before deploying so devices pick up changes.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$stage = Join-Path $root ".deploy"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path (Join-Path $stage "data") | Out-Null

Copy-Item index.html, manifest.webmanifest, sw.js $stage
Copy-Item -Recurse css, js, icons, audio, fonts $stage
if (Test-Path img) { Copy-Item -Recurse img $stage }                             # exercise anatomy renders (webp + manifest)
# Program plans. The PUBLIC repo ships none — a fresh install has no program and
# the in-app builder writes the first one. Personal blocks live in the private
# overlay, so this copies whatever is there (possibly nothing).
if (Test-Path overlay/data) {
  Get-ChildItem overlay/data -Filter *.json | ForEach-Object { Copy-Item $_.FullName (Join-Path $stage "data") }
}
if (Test-Path data/seed-sessions.json) {                                        # history auto-restore net
  Copy-Item data/seed-sessions.json (Join-Path $stage "data")
}

# --- private overlay -------------------------------------------------------
# The repo's js/config.js ships EMPTY (local-only, no secrets). overlay/config.js
# is gitignored and holds the real endpoints + token. Copy it over the staged
# copy so the deployed app is "public code + my values", and nothing else.
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
if ($applied.Count) { Write-Host "Applied private overlay: $($applied -join ', ')" }
else { Write-Host "No overlay/ found - deploying the PUBLIC build (local-only, generic routines)." }

# safety: refuse to deploy full backups / exported logs (those stay off the URL)
$leak = Get-ChildItem -Recurse $stage -Include "fitness-backup*.json", "fitness-log*.md"
if ($leak) { throw "Refusing to deploy: backup/export data in staging: $($leak.FullName)" }

# safety: the staged config must parse and must not be a half-applied overlay
$staged = Get-Content (Join-Path $stage "js/config.js") -Raw
if ($staged -notmatch "BUILD_CONFIG") { throw "Refusing to deploy: staged js/config.js looks wrong." }

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
Write-Host "Deployed. Wrangler prints the production URL above."
