# Builds everything that has to be uploaded, into server\publish.
#
# The dashboard is built first, because it builds into the API's wwwroot and
# `dotnet publish` copies wwwroot as it finds it. Doing it the other way round
# publishes yesterday's dashboard, which is a confusing thing to debug on a
# live site.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$api = Join-Path $root 'server\Warehouse.Api'
$dashboard = Join-Path $root 'dashboard'
$out = Join-Path $root 'server\publish'

Write-Host ''
Write-Host '  [1/3] Building the dashboard' -ForegroundColor Cyan
Push-Location $dashboard
try {
    if (-not (Test-Path 'node_modules')) { npm install --no-audit --no-fund }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'The dashboard build failed.' }
}
finally { Pop-Location }

Write-Host ''
Write-Host '  [2/3] Publishing the application' -ForegroundColor Cyan
if (Test-Path $out) { Remove-Item $out -Recurse -Force }

# Framework-dependent: the host already has the .NET 10 runtime, and shipping a
# copy would multiply the upload for nothing.
dotnet publish $api -c Release -o $out --nologo
if ($LASTEXITCODE -ne 0) { throw 'The publish failed.' }

Write-Host ''
Write-Host '  [3/3] Checking what came out' -ForegroundColor Cyan

$expected = @(
    'Warehouse.Api.dll',
    'web.config',
    'appsettings.json',
    'Data\schema.sql',
    'wwwroot\index.html'
)

$missing = $expected | Where-Object { -not (Test-Path (Join-Path $out $_)) }
if ($missing) {
    throw "These are missing from the package: $($missing -join ', ')"
}

# The placeholder must never reach a live site, so it is caught here rather
# than at three in the morning when the application refuses to start.
$settings = Get-Content (Join-Path $out 'appsettings.json') -Raw
if ($settings -match 'CHANGE-ME-BEFORE-DEPLOYING') {
    Write-Host ''
    Write-Host '  The signing secret is still the placeholder.' -ForegroundColor Yellow
    Write-Host '  Edit appsettings.json in the publish folder before uploading' -ForegroundColor Yellow
    Write-Host '  (DEPLOY.md, step 3). The application will refuse to start otherwise.' -ForegroundColor Yellow
}

$size = [math]::Round((Get-ChildItem $out -Recurse | Measure-Object Length -Sum).Sum / 1MB, 1)

Write-Host ''
Write-Host "  Ready: $out  ($size MB)" -ForegroundColor Green
Write-Host '  Upload the CONTENTS of that folder to your site root.'
Write-Host ''
